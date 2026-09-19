import { MARKET_APY_POOLS, MARKET_APY_START_MS } from "../market-pools";
import {
  beginFetchRun,
  finishFetchRun,
  readLastFetchRunSummary,
  readLatestFetchFinishedMs,
  readLatestPointTimestampMs,
  readStoredMarketSnapshot,
  replacePoolPoints,
  replaceRebalanceDecisions,
  upsertFetchRunItem,
  type DecisionUpsertInput,
  type MarketPoint,
  type StoredPool,
} from "./market-db";

const LLAMA_BASE = "https://yields.llama.fi/chart/";
const HOUR_MS = 3_600_000;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_RETRY = 4;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_REBALANCE_FEE_MIN_USDC = 0;
const DEFAULT_REBALANCE_FEE_RATE_BPS = 5;
const DEFAULT_STRATEGY_START_ASSETS = 1_000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
];

type ChartPoint = {
  timestamp: string;
  apy: number | null;
};

type ChartResponse = {
  status?: string;
  data?: ChartPoint[];
};

type FetchPoolSuccess = {
  ok: true;
  poolId: string;
  attempts: number;
  httpStatus: number;
  points: MarketPoint[];
};

type FetchPoolFailure = {
  ok: false;
  poolId: string;
  attempts: number;
  httpStatus: number | null;
  message: string;
};

type FetchPoolResult = FetchPoolSuccess | FetchPoolFailure;

export type SyncResult = {
  synced: boolean;
  runId?: number;
  message: string;
  successPools: string[];
  failedPools: string[];
};

export type SyncOptions = {
  force?: boolean;
  minIntervalMs?: number;
};

export type SyncRuntimeConfig = {
  fetchRetry: number;
  fetchTimeoutMs: number;
  fetchConcurrency: number;
  rebalanceWindowSeconds: number;
  rebalanceFeeRateBps: number;
  rebalanceFeeMinUsdc: number;
  rebalanceFeeUsdc: number;
  strategyStartAssets: number;
};

let activeSyncPromise: Promise<SyncResult> | null = null;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function getSyncRuntimeConfig(): SyncRuntimeConfig {
  const feeMinUsdc = Math.max(
    0,
    envNumber(
      "REBALANCE_FEE_MIN_USDC",
      envNumber("REBALANCE_FEE_USDC", DEFAULT_REBALANCE_FEE_MIN_USDC)
    )
  );
  const feeRateBps = Math.max(0, envNumber("REBALANCE_FEE_RATE_BPS", DEFAULT_REBALANCE_FEE_RATE_BPS));

  return {
    fetchRetry: Math.max(1, Math.floor(envNumber("APY_FETCH_RETRY", DEFAULT_RETRY))),
    fetchTimeoutMs: Math.max(2_000, Math.floor(envNumber("APY_FETCH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS))),
    fetchConcurrency: Math.max(1, Math.floor(envNumber("APY_FETCH_CONCURRENCY", DEFAULT_CONCURRENCY))),
    rebalanceWindowSeconds: Math.max(3_600, envNumber("REBALANCE_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS)),
    rebalanceFeeRateBps: feeRateBps,
    rebalanceFeeMinUsdc: feeMinUsdc,
    // Keep this field for backward compatibility with existing frontend payload readers.
    rebalanceFeeUsdc: feeMinUsdc,
    strategyStartAssets: Math.max(1, envNumber("STRATEGY_START_ASSETS", DEFAULT_STRATEGY_START_ASSETS)),
  };
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function safeApy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-95, Math.min(value, 300));
}

async function fetchWithRetry(url: string, retry: number, timeoutMs: number, poolOffset: number): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const ua = USER_AGENTS[(attempt + poolOffset) % USER_AGENTS.length];
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": ua,
        },
      });

      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retry) {
        throw new Error(`HTTP ${response.status}`);
      }

      const waitMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
      await sleep(waitMs);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === retry) {
        break;
      }

      const waitMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 160);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error("Request failed");
}

async function fetchPool(poolIndex: number): Promise<FetchPoolResult> {
  const pool = MARKET_APY_POOLS[poolIndex];
  const retry = Math.max(1, Math.floor(envNumber("APY_FETCH_RETRY", DEFAULT_RETRY)));
  const timeoutMs = Math.max(2_000, Math.floor(envNumber("APY_FETCH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)));

  try {
    const response = await fetchWithRetry(`${LLAMA_BASE}${pool.id}`, retry, timeoutMs, poolIndex);
    const payload = (await response.json()) as ChartResponse;
    const rawPoints = Array.isArray(payload.data) ? payload.data : [];
    const points = rawPoints
      .map((point) => ({
        t: Date.parse(point.timestamp),
        apy: safeApy(Number(point.apy ?? Number.NaN)),
      }))
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.apy) && point.t >= MARKET_APY_START_MS)
      .sort((a, b) => a.t - b.t)
      .map((point) => ({
        t: toHour(point.t),
        apy: round4(point.apy),
      }));

    const deduped: MarketPoint[] = [];
    let lastT = Number.NaN;
    for (const point of points) {
      if (point.t === lastT) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
      lastT = point.t;
    }

    return {
      ok: true,
      poolId: pool.id,
      attempts: retry,
      httpStatus: response.status,
      points: deduped,
    };
  } catch (error) {
    return {
      ok: false,
      poolId: pool.id,
      attempts: retry,
      httpStatus: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      if (current >= values.length) return;
      nextIndex += 1;
      out[current] = await mapper(values[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

function computeRebalanceDecisions(pools: StoredPool[]): DecisionUpsertInput[] {
  const endMs = pools.reduce((max, pool) => Math.max(max, pool.points[pool.points.length - 1]?.t ?? 0), MARKET_APY_START_MS);
  if (endMs <= MARKET_APY_START_MS) return [];

  const feeMinUsdc = Math.max(
    0,
    envNumber(
      "REBALANCE_FEE_MIN_USDC",
      envNumber("REBALANCE_FEE_USDC", DEFAULT_REBALANCE_FEE_MIN_USDC)
    )
  );
  const feeRateBps = Math.max(0, envNumber("REBALANCE_FEE_RATE_BPS", DEFAULT_REBALANCE_FEE_RATE_BPS));
  const windowSeconds = Math.max(3_600, envNumber("REBALANCE_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS));
  const startAssets = Math.max(1, envNumber("STRATEGY_START_ASSETS", DEFAULT_STRATEGY_START_ASSETS));

  const sortedPools = pools
    .map((pool) => ({
      ...pool,
      points: [...pool.points].sort((a, b) => a.t - b.t),
    }))
    .filter((pool) => pool.points.length > 0);

  if (sortedPools.length === 0) return [];

  const indexes = sortedPools.map(() => -1);
  const currentApys = sortedPools.map(() => 0);

  let activeIndex = 0;
  let assets = startAssets;
  const out: DecisionUpsertInput[] = [];

  for (let t = MARKET_APY_START_MS; t <= endMs; t += HOUR_MS) {
    for (let i = 0; i < sortedPools.length; i++) {
      const pool = sortedPools[i];
      let idx = indexes[i];
      while (idx + 1 < pool.points.length && pool.points[idx + 1].t <= t) {
        idx += 1;
      }
      indexes[i] = idx;
      if (idx >= 0) {
        currentApys[i] = pool.points[idx].apy;
      }
    }

    let bestIndex = 0;
    for (let i = 1; i < sortedPools.length; i++) {
      if (currentApys[i] > currentApys[bestIndex]) bestIndex = i;
    }

    if (out.length === 0) {
      activeIndex = bestIndex;
    }

    const bestPool = sortedPools[bestIndex];
    const activeApy = currentApys[activeIndex];
    const bestApy = currentApys[bestIndex];
    const deltaBps = Math.max(0, Math.round((bestApy - activeApy) * 100));
    const rebalanceFee = Math.max(feeMinUsdc, assets * (feeRateBps / 10_000));
    const expectedGain = assets * (deltaBps / 10_000) * (windowSeconds / YEAR_SECONDS);

    let shouldRebalance = false;
    let reason = "already_best";
    if (bestIndex !== activeIndex) {
      if (expectedGain > rebalanceFee) {
        shouldRebalance = true;
        reason = "rebalance_executed";
      } else {
        reason = "gain_below_fee";
      }
    }

    const assetsBefore = assets;
    let assetsAfterFee = assetsBefore;
    if (shouldRebalance) {
      activeIndex = bestIndex;
      assetsAfterFee = Math.max(0, assetsBefore - rebalanceFee);
    }

    const effectiveApy = currentApys[activeIndex];
    const growthFactor = 1 + effectiveApy / 100 / 365 / 24;
    const assetsAfterGrowth = Math.max(0, assetsAfterFee * Math.max(0.000001, growthFactor));

    out.push({
      t,
      activePoolId: sortedPools[activeIndex].id,
      activeApy: round4(currentApys[activeIndex]),
      bestPoolId: bestPool.id,
      bestApy: round4(bestApy),
      deltaBps,
      assetsBefore: round4(assetsBefore),
      expectedGain: round4(expectedGain),
      rebalanceFee: round4(rebalanceFee),
      shouldRebalance,
      reason,
      assetsAfterFee: round4(assetsAfterFee),
      assetsAfterGrowth: round4(assetsAfterGrowth),
      windowSeconds,
      updatedAt: Date.now(),
    });

    assets = assetsAfterGrowth;
  }

  return out;
}

export function shouldSyncMarketData(minIntervalMs = DEFAULT_SYNC_INTERVAL_MS): boolean {
  const snapshot = readStoredMarketSnapshot(0);
  if (snapshot.pools.length === 0) return true;

  const pointsCountByPoolId = new Map(snapshot.pools.map((pool) => [pool.id, pool.points.length]));
  const missingPoolData = MARKET_APY_POOLS.some((pool) => (pointsCountByPoolId.get(pool.id) ?? 0) === 0);
  if (missingPoolData) return true;

  const latestPointMs = readLatestPointTimestampMs();
  if (latestPointMs <= 0) return true;

  const latestSyncMs = readLatestFetchFinishedMs();
  if (latestSyncMs <= 0) return true;

  return Date.now() - latestSyncMs >= minIntervalMs;
}

export async function syncMarketData(options: SyncOptions = {}): Promise<SyncResult> {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  if (!options.force && !shouldSyncMarketData(minIntervalMs)) {
    // Even when APY pull is skipped, refresh decision rows so fee/window config changes
    // (for example REBALANCE_FEE_RATE_BPS) can take effect immediately.
    const snapshot = readStoredMarketSnapshot(0);
    if (snapshot.pools.length > 0) {
      const decisions = computeRebalanceDecisions(snapshot.pools);
      replaceRebalanceDecisions(decisions);
    }

    const summary = readLastFetchRunSummary();
    return {
      synced: false,
      message: summary?.message || "Skip sync: cache is fresh",
      successPools: [],
      failedPools: [],
    };
  }

  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    const runId = beginFetchRun();
    const source = `defillama:${new Date().toISOString()}`;
    const fetchedAt = Date.now();

    try {
      const poolIndexes = MARKET_APY_POOLS.map((_, idx) => idx);
      const concurrency = Math.max(1, Math.floor(envNumber("APY_FETCH_CONCURRENCY", DEFAULT_CONCURRENCY)));

      const results = await mapWithConcurrency(poolIndexes, concurrency, fetchPool);

      const okResults = results.filter((result): result is FetchPoolSuccess => result.ok);
      const failedResults = results.filter((result): result is FetchPoolFailure => !result.ok);

      for (const result of okResults) {
        replacePoolPoints(result.poolId, result.points, source, fetchedAt);
        upsertFetchRunItem({
          runId,
          poolId: result.poolId,
          attempts: result.attempts,
          httpStatus: result.httpStatus,
          status: "ok",
          pointsCount: result.points.length,
          message: `stored ${result.points.length} points`,
        });
      }

      for (const result of failedResults) {
        upsertFetchRunItem({
          runId,
          poolId: result.poolId,
          attempts: result.attempts,
          httpStatus: result.httpStatus,
          status: "error",
          pointsCount: 0,
          message: result.message,
        });
      }

      if (okResults.length === 0) {
        const message = "All APY pool fetch tasks failed";
        finishFetchRun(runId, "error", message);
        return {
          synced: false,
          runId,
          message,
          successPools: [],
          failedPools: failedResults.map((item) => item.poolId),
        };
      }

      const snapshot = readStoredMarketSnapshot(0);
      const decisions = computeRebalanceDecisions(snapshot.pools);
      replaceRebalanceDecisions(decisions);

      const message = `Synced ${okResults.length}/${MARKET_APY_POOLS.length} pools from DefiLlama`;
      finishFetchRun(runId, failedResults.length > 0 ? "error" : "ok", message);

      return {
        synced: true,
        runId,
        message,
        successPools: okResults.map((item) => item.poolId),
        failedPools: failedResults.map((item) => item.poolId),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishFetchRun(runId, "error", message);
      return {
        synced: false,
        runId,
        message,
        successPools: [],
        failedPools: MARKET_APY_POOLS.map((pool) => pool.id),
      };
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
