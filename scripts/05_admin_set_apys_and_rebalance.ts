import fs from "fs";
import path from "path";

import hre from "hardhat";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYER_PK =
  process.env.DEPLOYER_PK ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HOUR_MS = 3_600_000;
const LLAMA_BASE = "https://yields.llama.fi/chart/";
const FETCH_RETRY = Math.max(1, Number(process.env.APY_FETCH_RETRY ?? "4"));
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.APY_FETCH_TIMEOUT_MS ?? "12000"));
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.APY_FETCH_CONCURRENCY ?? "3"));
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
];

type MarketApyPool = {
  id: string;
  name: string;
  project: string;
  symbol: string;
};

type ChartPoint = {
  timestamp: string;
  apy: number | null;
};

type ChartResponse = {
  status?: string;
  data?: ChartPoint[];
};

const MARKET_APY_POOLS: MarketApyPool[] = [
  {
    id: "aa70268e-4b52-42bf-a116-608b370f9501",
    name: "Aave v3 USDC",
    project: "aave-v3",
    symbol: "USDC",
  },
  {
    id: "7da72d09-56ca-4ec5-a45f-59114353e487",
    name: "Compound v3 USDC",
    project: "compound-v3",
    symbol: "USDC",
  },
  {
    id: "65ce8276-b4d9-41ba-9f6f-21fc374cf9bc",
    name: "SparkLend USDC",
    project: "sparklend",
    symbol: "USDC",
  },
  {
    id: "4438dabc-7f0c-430b-8136-2722711ae663",
    name: "Fluid Lending USDC",
    project: "fluid-lending",
    symbol: "USDC",
  },
  {
    id: "f4d5b566-e815-4ca2-bb07-7bcd8bc797f1",
    name: "Compound v3 USDT",
    project: "compound-v3",
    symbol: "USDT",
  },
];

type Deployments = {
  VAULT?: string;
  POOLS?: string[];
};

function readDeployments(filePath: string): { vault: string; pools: string[] } {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Deployments;

  if (!parsed.VAULT) {
    throw new Error(`Missing VAULT in ${filePath}`);
  }
  if (!parsed.POOLS || parsed.POOLS.length === 0) {
    throw new Error(`Missing POOLS in ${filePath}. Run scripts/04_deploy_5_pools_and_vault.ts first.`);
  }

  return { vault: parsed.VAULT, pools: parsed.POOLS };
}

function parseApyInput(poolCount: number): bigint[] | null {
  const input = process.env.APYS_BPS?.trim();
  if (!input) return null;

  const parts = input.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length !== poolCount) {
    throw new Error(
      `APYS_BPS must contain exactly ${poolCount} values, got ${parts.length}. Example: APYS_BPS=300,450,520,610,800`
    );
  }

  return parts.map((p) => {
    const v = BigInt(p);
    if (v < 0n || v > 100_000n) throw new Error(`Invalid APY bps value: ${p}`);
    return v;
  });
}

function toHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function toApyBps(apyPct: number): bigint {
  if (!Number.isFinite(apyPct)) {
    throw new Error(`Invalid APY percentage: ${apyPct}`);
  }
  const clipped = Math.max(0, Math.min(apyPct, 1000));
  return BigInt(Math.round(clipped * 100));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url: string, poolOffset: number): Promise<{ res: any; attempts: number }> {
  const fetchFn = (globalThis as any).fetch as
    | ((input: string, init?: Record<string, unknown>) => Promise<any>)
    | undefined;
  if (!fetchFn) {
    throw new Error("global fetch is unavailable in current Node runtime");
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= FETCH_RETRY; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const ua = USER_AGENTS[(attempt + poolOffset) % USER_AGENTS.length];

    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": ua,
        },
      });

      clearTimeout(timer);

      const retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
      if (!res.ok && retryable && attempt < FETCH_RETRY) {
        const waitMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return { res, attempts: attempt };
    } catch (error: any) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === FETCH_RETRY) break;

      const waitMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 160);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error("request failed");
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

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, values.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}

async function fetchPoolApyBpsAtHour(
  pool: MarketApyPool,
  targetHourMs: number,
  poolIndex: number
): Promise<{ bps: bigint; apyPct: number; sampleMs: number; attempts: number }> {
  const { res, attempts } = await fetchWithRetry(`${LLAMA_BASE}${pool.id}`, poolIndex);

  const json = (await res.json()) as ChartResponse;
  const raw = Array.isArray(json.data) ? json.data : [];
  const points = raw
    .map((x) => ({
      t: Date.parse(x.timestamp),
      apy: Number(x.apy ?? Number.NaN),
    }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.apy))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) {
    throw new Error(`no APY points returned for ${pool.name}`);
  }

  // Use hourly buckets so the local chain APY updates follow hourly market snapshots.
  let chosen = points[0];
  for (const p of points) {
    if (toHour(p.t) <= targetHourMs) chosen = p;
    else break;
  }

  return {
    bps: toApyBps(chosen.apy),
    apyPct: chosen.apy,
    sampleMs: chosen.t,
    attempts,
  };
}

async function fetchMarketApysBps(
  poolCount: number,
  currentApys: bigint[]
): Promise<{
  targetHourMs: number;
  nextApys: bigint[];
  details: string[];
}> {
  const nowMs =
    process.env.APY_TIME_MS && Number.isFinite(Number(process.env.APY_TIME_MS))
      ? Number(process.env.APY_TIME_MS)
      : Date.now();
  const targetHourMs = toHour(nowMs);

  if (MARKET_APY_POOLS.length === 0) {
    throw new Error("MARKET_APY_POOLS is empty");
  }

  const selectedPools = MARKET_APY_POOLS.slice(0, poolCount);
  const results = await mapWithConcurrency(
    selectedPools,
    FETCH_CONCURRENCY,
    async (pool, poolIndex) => {
      try {
        const res = await fetchPoolApyBpsAtHour(pool, targetHourMs, poolIndex);
        return { ok: true as const, pool, ...res };
      } catch (error: any) {
        return {
          ok: false as const,
          pool,
          message: error?.message || String(error),
        };
      }
    }
  );

  const nextApys = Array.from({ length: poolCount }, (_, i) => currentApys[i] ?? 0n);
  const details: string[] = [];
  let success = 0;

  for (let i = 0; i < poolCount; i++) {
    const r = results[i];
    if (!r) {
      details.push(`[${i}] missing market pool mapping, keep ${nextApys[i].toString()} bps`);
      continue;
    }
    if (!r.ok) {
      details.push(
        `[${i}] ${r.pool.name} fetch failed (${r.message}), keep ${nextApys[i].toString()} bps`
      );
      continue;
    }

    nextApys[i] = r.bps;
    success += 1;
      details.push(
      `[${i}] ${r.pool.name} ${r.apyPct.toFixed(4)}% -> ${r.bps.toString()} bps (sample ${new Date(
        r.sampleMs
      ).toISOString()}, attempts=${r.attempts})`
    );
  }

  if (success === 0) {
    throw new Error("Failed to fetch APY for all pools");
  }

  return { targetHourMs, nextApys, details };
}

async function main() {
  const deploymentsPath = path.resolve("deployments.local.json");
  const { vault: vaultAddr, pools } = readDeployments(deploymentsPath);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const rawDeployer = new ethers.Wallet(DEPLOYER_PK, provider);
  const deployer = new ethers.NonceManager(rawDeployer);

  const vaultArt = await hre.artifacts.readArtifact("StrategyVault");
  const poolArt = await hre.artifacts.readArtifact("MockPool");

  const vault = new ethers.Contract(vaultAddr, vaultArt.abi, deployer);
  const poolContracts = pools.map((addr) => new ethers.Contract(addr, poolArt.abi, deployer));

  const currentApys = await Promise.all(poolContracts.map((pool) => pool.apy() as Promise<bigint>));
  const providedApys = parseApyInput(pools.length);

  let nextApys: bigint[];
  let apySourceLabel = "APYS_BPS override";
  let fetchDetails: string[] = [];
  if (providedApys) {
    nextApys = providedApys;
  } else {
    const fetched = await fetchMarketApysBps(pools.length, currentApys);
    nextApys = fetched.nextApys;
    apySourceLabel = `DefiLlama hourly snapshot @ ${new Date(
      fetched.targetHourMs
    ).toISOString()}`;
    fetchDetails = fetched.details;
  }

  console.log("Vault:", vaultAddr);
  console.log("Admin:", await rawDeployer.getAddress());
  console.log("APY source:", apySourceLabel);
  if (fetchDetails.length > 0) {
    for (const line of fetchDetails) console.log(`  ${line}`);
  }
  console.log("Pools:");
  pools.forEach((p, i) => {
    console.log(
      `  [${i}] ${p}  ${currentApys[i].toString()} -> ${nextApys[i].toString()} bps`
    );
  });

  for (let i = 0; i < pools.length; i++) {
    if (currentApys[i] === nextApys[i]) continue;
    const tx = await vault.adminSetPoolAPY(pools[i], nextApys[i]);
    await tx.wait();
    console.log(`APY updated pool[${i}] tx: ${tx.hash}`);
  }

  const activePool = (await vault.activePool()) as string;
  const bestPool = (await vault.bestPool()) as string;
  const expectedGain = (await vault.expectedGainIfRebalance(activePool, bestPool)) as bigint;
  const gasCostAssets = (await vault.gasCostAssets()) as bigint;

  console.log("activePool:", activePool);
  console.log("bestPool  :", bestPool);
  console.log("expectedGain:", expectedGain.toString());
  console.log("gasCostAssets:", gasCostAssets.toString());

  if (
    activePool.toLowerCase() !== bestPool.toLowerCase() &&
    expectedGain >= gasCostAssets
  ) {
    const tx = await vault.rebalance();
    await tx.wait();
    console.log(`Rebalanced tx: ${tx.hash}`);
  } else {
    console.log("Skip rebalance: either activePool is already best, or expected gain is below cost.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
