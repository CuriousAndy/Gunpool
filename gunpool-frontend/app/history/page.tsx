"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ConsoleLayout } from "@/src/components/layout/console-layout";
import {
  DEFAULT_DEMO_WALLET_STATE,
  DEMO_WALLET_STATE_CHANGE_EVENT,
  ensureDemoWalletState,
  type DemoWalletState,
} from "@/src/lib/demo-wallet";
import type {
  MarketApyApiPayload,
  MarketPoolPayload,
  RebalanceDecisionPayload,
} from "../../src/lib/market-api-types";

type EChartsProps = Record<string, unknown>;

const ReactECharts = dynamic(
  async () => {
    const mod = (await import("echarts-for-react")) as {
      default: ComponentType<EChartsProps> | { default?: ComponentType<EChartsProps> };
    };
    return typeof mod.default === "function" ? mod.default : mod.default.default!;
  },
  { ssr: false }
);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DEMO_TRACK_USER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const DEMO_DECIMALS = 6;
const PRIMARY_COLOR = "#003689";
const PRIMARY_SOFT = "rgba(0, 54, 137, 0.10)";
const ASSET_RECORD_INITIAL_COUNT = 10;
const ASSET_RECORD_BATCH_COUNT = 10;

type HistoryRow = {
  id: string;
  blockNumber: bigint;
  logIndex: number;
  blockTimeMs: number;
  txHash: string;
  eventType: "Rebalanced" | "PoolAPYUpdated" | "ActivePoolUpdated" | "Deposit" | "Withdraw";
  summary: string;
  detail: string;
};

type UserFlow = {
  id: string;
  blockNumber: bigint;
  logIndex: number;
  blockTimeMs: number;
  kind: "Deposit" | "Withdraw";
  amountRaw: bigint;
};

type Curve = {
  points: Array<[number, number]>;
  depMarks: Array<[number, number]>;
  wdMarks: Array<[number, number]>;
  yMin: number;
  yMax: number;
  apyByHour: Map<number, number>;
};

type AssetChangeRow = {
  key: string;
  granularity: "hour" | "day";
  fromMs: number;
  toMs: number;
  deposit: number;
  withdraw: number;
  newInterest: number;
  cumulativeInterest: number;
  cumulativeAmount: number;
};

type AssetFlowSeries = {
  times: number[];
  depositPrefix: number[];
  withdrawPrefix: number[];
  netPrefix: number[];
};

type AssetChangePage = {
  rows: AssetChangeRow[];
  totalCount: number;
};

type HistoryDemoState = {
  trackedUser: string;
  latestBlock: bigint;
  activeApyPct: number;
  rows: HistoryRow[];
  flows: UserFlow[];
  marketPayload: MarketApyApiPayload;
};

type MockUserFlowSeed = {
  id: string;
  blockNumber: bigint;
  logIndex: number;
  blockTimeMs: number;
  kind: UserFlow["kind"];
  amount: number;
};

type HistorySectionView = "assets" | "apy" | "summary" | "events" | "decisions";

const HISTORY_TABS: Array<{ key: HistorySectionView; label: string }> = [
  { key: "assets", label: "资金变化记录" },
  { key: "apy", label: "历史利率曲线" },
  { key: "summary", label: "调仓决策摘要" },
  { key: "events", label: "链上事件" },
  { key: "decisions", label: "调仓记录" },
];

function eventTypeLabel(eventType: HistoryRow["eventType"]): string {
  switch (eventType) {
    case "Rebalanced":
      return "调仓";
    case "PoolAPYUpdated":
      return "池子年化更新";
    case "ActivePoolUpdated":
      return "主池切换";
    case "Deposit":
      return "存入";
    case "Withdraw":
      return "取出";
    default:
      return eventType;
  }
}

function decisionReasonLabel(reason: string): string {
  switch (reason) {
    case "already_best":
      return "不调仓：当前池已是最高 APY";
    case "gain_below_fee":
      return "不调仓：预期增益不足覆盖手续费";
    case "rebalance_executed":
      return "执行调仓：增益可覆盖手续费";
    default:
      return reason;
  }
}

function toHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function toDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function assetAtOrBefore(points: Array<[number, number]>, t: number): number {
  if (points.length === 0) return 0;
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? points[ans][1] : points[0][1];
}

function fmtTime(ms: number): string {
  if (!ms) return "--";
  const d = new Date(ms);
  return d.toLocaleString();
}

function fmtFocusTime(ms: number): string {
  if (!ms) return "--";
  const d = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDecisionPoolName(name: string): string {
  return name.replace(/\s*USDC\b/gi, "").trim();
}

function grow(assets: number, apyPct: number, dtMs: number): number {
  if (assets <= 0 || dtMs <= 0) return assets;
  const hourlyRate = apyPct / 100 / 365 / 24;
  const factor = Math.pow(1 + Math.max(-0.999999, hourlyRate), dtMs / HOUR_MS);
  if (!Number.isFinite(factor)) return assets;
  return assets * factor;
}

function asNum(raw: bigint, decimals: number): number {
  if (decimals < 0) return 0;
  const scale = 10 ** decimals;
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const n = Number(raw) / scale;
  return Number.isFinite(n) ? n : 0;
}

function formatDisplayUsdc(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs < 0.01) return value < 0 ? ">-0.01" : "<0.01";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDisplayTenNeg4(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const scaled = value * 10_000;
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(scaled.toFixed(2)));
}

function compactHash(value: string): string {
  if (!value) return "--";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function buildMockTxHash(blockNumber: bigint, logIndex: number): string {
  const seeds = [
    Number(blockNumber % 2147483647n),
    logIndex + 1,
    Number((blockNumber * 17n + BigInt(logIndex) * 97n) % 2147483647n),
    Number((blockNumber * 53n + BigInt(logIndex) * 193n + 7n) % 2147483647n),
  ];

  let hashHex = "";
  for (let i = 0; i < 8; i++) {
    let seed = seeds[i % seeds.length] + i * 7919;
    seed = (seed * 48271 + 12820163) % 2147483647;
    hashHex += seed.toString(16).padStart(8, "0");
  }

  return `0x${hashHex.slice(0, 64)}`;
}

function buildMockUserFlowSeeds(now: number): MockUserFlowSeed[] {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const MINUTE = 60_000;

  return [
    {
      id: "mock-deposit-1",
      blockNumber: 1001n,
      logIndex: 0,
      blockTimeMs: now - 29 * DAY,
      kind: "Deposit",
      amount: 1000,
    },
    {
      id: "mock-deposit-2",
      blockNumber: 1002n,
      logIndex: 1,
      blockTimeMs: now - 15 * DAY,
      kind: "Deposit",
      amount: 415,
    },
    {
      id: "mock-deposit-3",
      blockNumber: 1052n,
      logIndex: 0,
      blockTimeMs: now - 9 * HOUR - 20 * MINUTE,
      kind: "Deposit",
      amount: 28.4,
    },
    {
      id: "mock-withdraw-2",
      blockNumber: 1053n,
      logIndex: 0,
      blockTimeMs: now - 8 * HOUR - 5 * MINUTE,
      kind: "Withdraw",
      amount: 9.6,
    },
    {
      id: "mock-deposit-4",
      blockNumber: 1054n,
      logIndex: 0,
      blockTimeMs: now - 7 * HOUR - 10 * MINUTE,
      kind: "Deposit",
      amount: 16.8,
    },
    {
      id: "mock-deposit-5",
      blockNumber: 1055n,
      logIndex: 0,
      blockTimeMs: now - 6 * HOUR - 35 * MINUTE,
      kind: "Deposit",
      amount: 22.7,
    },
    {
      id: "mock-withdraw-3",
      blockNumber: 1056n,
      logIndex: 0,
      blockTimeMs: now - 5 * HOUR - 12 * MINUTE,
      kind: "Withdraw",
      amount: 14.2,
    },
    {
      id: "mock-deposit-6",
      blockNumber: 1057n,
      logIndex: 0,
      blockTimeMs: now - 4 * HOUR - 26 * MINUTE,
      kind: "Deposit",
      amount: 10.9,
    },
    {
      id: "mock-deposit-7",
      blockNumber: 1058n,
      logIndex: 0,
      blockTimeMs: now - 3 * HOUR - 48 * MINUTE,
      kind: "Deposit",
      amount: 31.5,
    },
    {
      id: "mock-withdraw-4",
      blockNumber: 1059n,
      logIndex: 0,
      blockTimeMs: now - 2 * HOUR - 16 * MINUTE,
      kind: "Withdraw",
      amount: 21.2,
    },
    {
      id: "mock-deposit-8",
      blockNumber: 1060n,
      logIndex: 0,
      blockTimeMs: now - 1 * HOUR - 22 * MINUTE,
      kind: "Deposit",
      amount: 18.4,
    },
    {
      id: "mock-deposit-9",
      blockNumber: 1061n,
      logIndex: 0,
      blockTimeMs: now - 38 * MINUTE,
      kind: "Deposit",
      amount: 1.3,
    },
    {
      id: "mock-withdraw-1",
      blockNumber: 1010n,
      logIndex: 0,
      blockTimeMs: now - 5 * DAY,
      kind: "Withdraw",
      amount: 200,
    },
  ];
}

function buildVisibleAssetChangeRows(
  points: Array<[number, number]>,
  flowSeries: AssetFlowSeries,
  endMs: number,
  granularity: "hour" | "day",
  limit: number
): AssetChangePage {
  if (points.length === 0 || limit <= 0) return { rows: [], totalCount: 0 };

  const startMs = points[0][0];
  const initialAmount = assetAtOrBefore(points, startMs);
  const bucketMs = granularity === "hour" ? HOUR_MS : DAY_MS;
  const alignedStart = granularity === "hour" ? toHour(startMs) : toDay(startMs);
  const effectiveEndMs = Math.max(endMs, startMs + 1);
  const alignedEnd = granularity === "hour" ? toHour(effectiveEndMs - 1) : toDay(effectiveEndMs - 1);
  const totalCount = Math.max(0, Math.ceil((effectiveEndMs - alignedStart) / bucketMs));

  const sumAt = (prefix: number[], ts: number): number => {
    const idx = upperBound(flowSeries.times, ts);
    return prefix[idx] ?? 0;
  };
  const sumInRange = (prefix: number[], fromExclusive: number, toInclusive: number): number =>
    sumAt(prefix, toInclusive) - sumAt(prefix, fromExclusive);
  const netUntil = (ts: number): number => sumAt(flowSeries.netPrefix, ts);

  const rows: AssetChangeRow[] = [];
  for (let cursor = alignedEnd; cursor >= alignedStart && rows.length < limit; cursor -= bucketMs) {
    const fromMs = Math.max(startMs, cursor);
    const toMs = Math.min(effectiveEndMs, cursor + bucketMs);
    if (toMs <= fromMs) continue;

    const startAmount = assetAtOrBefore(points, fromMs);
    const endAmount = assetAtOrBefore(points, toMs);
    const deposit = Math.max(0, sumInRange(flowSeries.depositPrefix, fromMs, toMs));
    const withdraw = Math.max(0, sumInRange(flowSeries.withdrawPrefix, fromMs, toMs));
    const newInterest = endAmount - startAmount - (deposit - withdraw);
    const cumulativeInterest = endAmount - initialAmount - (netUntil(toMs) - netUntil(startMs));

    rows.push({
      key: `${granularity}-${fromMs}-${toMs}`,
      granularity,
      fromMs,
      toMs,
      deposit: Number(deposit.toFixed(6)),
      withdraw: Number(withdraw.toFixed(6)),
      newInterest: Number(newInterest.toFixed(6)),
      cumulativeInterest: Number(cumulativeInterest.toFixed(6)),
      cumulativeAmount: Number(endAmount.toFixed(6)),
    });
  }

  return { rows, totalCount };
}

// ====== 仿真数据 — 调仓分析页演示模式 ======
const MOCK_CURRENT_ASSETS = 1308.73; // 仿真当前资金余额（净存入1300，利息约+8.73，确保累计收益为正）

function buildMockHistoryMarketPayload(): MarketApyApiPayload {
  const now = Date.now();
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const start = now - 30 * DAY;

  function sr(seed: number, offset: number): number {
    const x = Math.sin(seed * 9301 + offset * 49297 + 233) * 93647.3;
    return x - Math.floor(x);
  }

  const poolDefs = [
    { id: "aave-v3-usdc", name: "Aave V3 USDC", color: "#6366f1", baseApy: 4.8 },
    { id: "compound-v3-usdc", name: "Compound V3 USDC", color: "#22c55e", baseApy: 3.9 },
    { id: "venus-usdc", name: "Venus USDC", color: "#f59e0b", baseApy: 5.2 },
    { id: "morpho-usdc", name: "Morpho USDC", color: "#ef4444", baseApy: 5.6 },
    { id: "spark-usdc", name: "Spark USDC", color: "#06b6d4", baseApy: 4.5 },
    { id: "radiant-usdc", name: "Radiant USDC", color: "#a855f7", baseApy: 6.0 },
    { id: "silo-usdc", name: "Silo USDC", color: "#14b8a6", baseApy: 5.4 },
  ];

  const pools: MarketPoolPayload[] = poolDefs.map((def, pi) => {
    const points: { t: number; apy: number }[] = [];
    for (let h = 0; h <= 30 * 24; h++) {
      const t = start + h * HOUR;
      const trend = Math.sin((h / (30 * 24)) * Math.PI * 4 + pi) * 1.1;
      const noise = (sr(h, pi) - 0.5) * 0.8;
      points.push({ t, apy: Number(Math.max(1.0, def.baseApy + trend + noise).toFixed(3)) });
    }
    return { id: def.id, name: def.name, project: "Mock", symbol: "USDC", color: def.color, points };
  });

  // 仿真决策记录（每6小时一条）
  const decisions: RebalanceDecisionPayload[] = [];
  for (let i = 0; i < 120; i++) {
    const t = now - i * 6 * HOUR;
    const deltaV = (sr(i, 5) - 0.3) * 200;
    const shouldRebalance = deltaV > 20 && i % 8 === 0;
    const rotatingBestPool = poolDefs[2 + (i % (poolDefs.length - 2))];
    const bestPool = shouldRebalance ? rotatingBestPool : poolDefs[0];
    decisions.push({
      t,
      activePoolId: poolDefs[0].id,
      activePoolName: poolDefs[0].name,
      activeApy: 4.8 + (sr(i, 1) - 0.5) * 0.8,
      bestPoolId: bestPool.id,
      bestPoolName: bestPool.name,
      bestApy: bestPool.baseApy + (sr(i, 2) - 0.5) * 0.6,
      deltaBps: Math.round(Math.abs(deltaV)),
      assetsBefore: MOCK_CURRENT_ASSETS,
      expectedGain: Number((Math.abs(deltaV) / 100 * 0.02).toFixed(6)),
      rebalanceFee: 0.03,
      shouldRebalance,
      reason: shouldRebalance ? "rebalance_executed" : "gain_below_fee",
      assetsAfterFee: MOCK_CURRENT_ASSETS - 0.03,
      assetsAfterGrowth: MOCK_CURRENT_ASSETS,
      windowSeconds: 86400,
      updatedAt: t,
    });
  }

  return {
    ok: true,
    startMs: start,
    endMs: now,
    updatedAt: now,
    pools,
    decisions,
    systemProfile: {
      fetchRetry: 3, fetchTimeoutMs: 8000, fetchConcurrency: 3,
      rebalanceWindowSeconds: 86400, rebalanceFeeRateBps: 5,
      rebalanceFeeMinUsdc: 0, rebalanceFeeUsdc: 0,
      strategyStartAssets: 1000, database: "mock",
      startDate: new Date(start).toISOString().slice(0, 10), antiCrawler: "none",
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildMockHistoryRows(): HistoryRow[] {
  const now = Date.now();
  const DAY = 86_400_000;
  return [
    {
      id: "mock-rebalance-1",
      blockNumber: 1045n,
      logIndex: 2,
      blockTimeMs: now - 2 * DAY,
      txHash: "0xabc123demo000000000000000000000000000000000000000000000000000001",
      eventType: "Rebalanced",
      summary: "Aave V3 → Venus USDC",
      detail: "增益 0.0241 mUSDC > 手续费 0.03 mUSDC，执行调仓",
    },
    {
      id: "mock-deposit-2",
      blockNumber: 1002n,
      logIndex: 1,
      blockTimeMs: now - 15 * DAY,
      txHash: "0xabc123demo000000000000000000000000000000000000000000000000000002",
      eventType: "Deposit",
      summary: "0x06806... → Vault",
      detail: "+500.0000 mUSDC",
    },
    {
      id: "mock-deposit-1",
      blockNumber: 1001n,
      logIndex: 0,
      blockTimeMs: now - 29 * DAY,
      txHash: "0xabc123demo000000000000000000000000000000000000000000000000000003",
      eventType: "Deposit",
      summary: "0x06806... → Vault",
      detail: "+1000.0000 mUSDC",
    },
    {
      id: "mock-withdraw-1",
      blockNumber: 1010n,
      logIndex: 0,
      blockTimeMs: now - 5 * DAY,
      txHash: "0xabc123demo000000000000000000000000000000000000000000000000000004",
      eventType: "Withdraw",
      summary: "Vault → 0x06806...",
      detail: "-200.0000 mUSDC",
    },
    {
      id: "mock-rebalance-2",
      blockNumber: 1008n,
      logIndex: 1,
      blockTimeMs: now - 8 * DAY,
      txHash: "0xabc123demo000000000000000000000000000000000000000000000000000005",
      eventType: "Rebalanced",
      summary: "Compound V3 → Aave V3",
      detail: "增益 0.0318 mUSDC > 手续费 0.03 mUSDC，执行调仓",
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildMockFlows(): UserFlow[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const decimals = 6;
  function toRaw(amount: number): bigint {
    return BigInt(Math.round(amount * 10 ** decimals));
  }
  return [
    {
      id: "mock-deposit-1",
      blockNumber: 1001n,
      logIndex: 0,
      blockTimeMs: now - 29 * DAY,
      kind: "Deposit",
      amountRaw: toRaw(1000),
    },
    {
      id: "mock-deposit-2",
      blockNumber: 1002n,
      logIndex: 1,
      blockTimeMs: now - 15 * DAY,
      kind: "Deposit",
      amountRaw: toRaw(500),
    },
    {
      id: "mock-withdraw-1",
      blockNumber: 1010n,
      logIndex: 0,
      blockTimeMs: now - 5 * DAY,
      kind: "Withdraw",
      amountRaw: toRaw(200),
    },
  ];
}
// ====== 仿真数据结束 ======

function buildMockHistoryRowsRealistic(now: number): HistoryRow[] {
  const DAY = 86_400_000;
  const flowRows: HistoryRow[] = buildMockUserFlowSeeds(now).map((seed) => ({
    id: seed.id,
    blockNumber: seed.blockNumber,
    logIndex: seed.logIndex,
    blockTimeMs: seed.blockTimeMs,
    txHash: buildMockTxHash(seed.blockNumber, seed.logIndex),
    eventType: seed.kind,
    summary: seed.kind === "Deposit" ? "0x06806... → Vault" : "Vault → 0x06806...",
    detail: `${seed.kind === "Deposit" ? "+" : "-"}${seed.amount.toFixed(4)} mUSDC`,
  }));

  return [
    {
      id: "mock-rebalance-1",
      blockNumber: 1045n,
      logIndex: 2,
      blockTimeMs: now - 2 * DAY,
      txHash: buildMockTxHash(1045n, 2),
      eventType: "Rebalanced",
      summary: "Aave V3 → Venus USDC",
      detail: "增益 0.0241 mUSDC > 手续费 0.03 mUSDC，执行调仓",
    },
    ...flowRows,
    {
      id: "mock-rebalance-2",
      blockNumber: 1008n,
      logIndex: 1,
      blockTimeMs: now - 8 * DAY,
      txHash: buildMockTxHash(1008n, 1),
      eventType: "Rebalanced",
      summary: "Compound V3 → Aave V3",
      detail: "增益 0.0318 mUSDC > 手续费 0.03 mUSDC，执行调仓",
    },
  ];
}

function buildMockFlowsRealistic(now: number): UserFlow[] {
  const decimals = 6;

  function toRaw(amount: number): bigint {
    return BigInt(Math.round(amount * 10 ** decimals));
  }

  return buildMockUserFlowSeeds(now).map((seed) => ({
    id: seed.id,
    blockNumber: seed.blockNumber,
    logIndex: seed.logIndex,
    blockTimeMs: seed.blockTimeMs,
    kind: seed.kind,
    amountRaw: toRaw(seed.amount),
  }));
}

function buildHistoryDemoState(): HistoryDemoState {
  const now = Date.now();
  const rows = [...buildMockHistoryRowsRealistic(now)].sort((a, b) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1
  );
  const flows = [...buildMockFlowsRealistic(now)].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
  );
  const marketPayload = buildMockHistoryMarketPayload();
  const latestBlock = rows.reduce((max, row) => (row.blockNumber > max ? row.blockNumber : max), 0n);
  const activeApyPct = marketPayload.decisions[0]?.activeApy ?? 4.8;

  return {
    trackedUser: DEMO_TRACK_USER,
    latestBlock,
    activeApyPct,
    rows,
    flows,
    marketPayload,
  };
}

const HISTORY_DEMO = buildHistoryDemoState();

function buildHourlyBestApy(
  pools: MarketPoolPayload[],
  startMs: number,
  endMs: number
): Array<[number, number]> {
  const s = toHour(startMs);
  const e = toHour(endMs);
  if (e < s) return [];

  const sortedPools = pools
    .filter((pool) => pool.points.length > 0)
    .map((pool) => [...pool.points].sort((a, b) => a.t - b.t));
  const idx = sortedPools.map(() => -1);
  const out: Array<[number, number]> = [];

  for (let t = s; t <= e; t += HOUR_MS) {
    let best = 0;
    for (let i = 0; i < sortedPools.length; i++) {
      let k = idx[i];
      while (k + 1 < sortedPools[i].length && sortedPools[i][k + 1].t <= t) k++;
      idx[i] = k;
      if (k >= 0) best = Math.max(best, sortedPools[i][k].apy);
    }
    out.push([t, Number(best.toFixed(4))]);
  }

  return out;
}

function findApyAtOrBefore(pool: MarketPoolPayload, ts: number): number {
  if (pool.points.length === 0) return 0;
  let latest = pool.points[0].apy;
  for (const point of pool.points) {
    if (point.t > ts) break;
    latest = point.apy;
  }
  return latest;
}

function buildCurve(
  flows: UserFlow[],
  decimals: number,
  currentAssets: number,
  hourlyApy: Array<[number, number]>,
  fallbackApy: number,
  endMs: number
): Curve {
  const sortedFlows = [...flows]
    .filter((flow) => Number.isFinite(flow.blockTimeMs) && flow.blockTimeMs > 0)
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
        ? -1
        : 1
    );

  const fallbackStart = Math.max(endMs - 7 * DAY_MS, 0);
  const s = toHour(Math.min(sortedFlows[0]?.blockTimeMs ?? fallbackStart, endMs));
  const e = Math.max(endMs, s);
  const apyByHour = new Map<number, number>(hourlyApy.map(([t, apy]) => [toHour(t), apy]));
  const getApy = (t: number) => apyByHour.get(toHour(t)) ?? fallbackApy;

  const points: Array<[number, number]> = [[s, 0]];
  const depMarks: Array<[number, number]> = [];
  const wdMarks: Array<[number, number]> = [];

  let assets = 0;
  let cursor = s;
  let i = 0;

  while (cursor < e) {
    const hourStart = toHour(cursor);
    const hourEnd = Math.min(hourStart + HOUR_MS, e);
    const apy = getApy(hourStart);

    while (i < sortedFlows.length && sortedFlows[i].blockTimeMs <= hourEnd) {
      const flow = sortedFlows[i];
      const t = Math.max(cursor, flow.blockTimeMs);
      if (t > cursor) {
        assets = grow(assets, apy, t - cursor);
        points.push([t, Number(assets.toFixed(6))]);
        cursor = t;
      }

      const delta = asNum(flow.amountRaw, decimals) * (flow.kind === "Deposit" ? 1 : -1);
      const before = assets;
      const after = Math.max(0, before + delta);
      points.push([t, Number(before.toFixed(6))]);
      points.push([t, Number(after.toFixed(6))]);

      if (flow.kind === "Deposit") depMarks.push([t, Number(after.toFixed(6))]);
      else wdMarks.push([t, Number(after.toFixed(6))]);

      assets = after;
      cursor = t;
      i += 1;
    }

    if (cursor < hourEnd) {
      assets = grow(assets, apy, hourEnd - cursor);
      cursor = hourEnd;
      points.push([cursor, Number(assets.toFixed(6))]);
    }
  }

  const endPred = points[points.length - 1]?.[1] ?? 0;
  const offset = Math.max(0, currentAssets) - endPred;
  if (Math.abs(offset) > 1e-6) {
    for (let k = 0; k < points.length; k++) {
      points[k] = [points[k][0], Number(Math.max(0, points[k][1] + offset).toFixed(6))];
    }
    for (let k = 0; k < depMarks.length; k++) {
      depMarks[k] = [depMarks[k][0], Number(Math.max(0, depMarks[k][1] + offset).toFixed(6))];
    }
    for (let k = 0; k < wdMarks.length; k++) {
      wdMarks[k] = [wdMarks[k][0], Number(Math.max(0, wdMarks[k][1] + offset).toFixed(6))];
    }
  }

  const vals = points.map((p) => p[1]);
  const lo = Math.max(0, Math.min(...vals, 0));
  const hi = Math.max(...vals, 0);
  const span = Math.max(1, hi - lo);

  return {
    points,
    depMarks,
    wdMarks,
    yMin: Number(Math.max(0, lo - span * 0.08).toFixed(4)),
    yMax: Number((hi + span * 0.14 + 0.02).toFixed(4)),
    apyByHour,
  };
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryPageFallback />}>
      <HistoryPageContent />
    </Suspense>
  );
}

function HistoryPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rows = HISTORY_DEMO.rows;
  const flows = HISTORY_DEMO.flows;
  const latestBlock = HISTORY_DEMO.latestBlock;
  const marketPayload = HISTORY_DEMO.marketPayload;
  const activeApyPct = HISTORY_DEMO.activeApyPct;
  const user = HISTORY_DEMO.trackedUser;
  const decimals = DEMO_DECIMALS;
  const [demoWalletState, setDemoWalletState] = useState<DemoWalletState>(() => {
    if (typeof window === "undefined") return DEFAULT_DEMO_WALLET_STATE;
    return ensureDemoWalletState();
  });
  const currentAssetsValue = demoWalletState.vaultBalance;
  const currentAssetsText = formatDisplayUsdc(currentAssetsValue);

  const [keyword, setKeyword] = useState("");
  const [txKeyword, setTxKeyword] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [decisionReasonFilter, setDecisionReasonFilter] = useState<string>("all");
  const [focusDecisionTs, setFocusDecisionTs] = useState<number | null>(null);
  const [selectedDecisionTs, setSelectedDecisionTs] = useState<number[]>([]);
  const [decisionFiltersOpen, setDecisionFiltersOpen] = useState(false);
  const [selectedApyPoolIds, setSelectedApyPoolIds] = useState<string[]>(() => {
    const preferredIds = ["compound-v3-usdc", "spark-usdc"];
    const availablePoolIds = HISTORY_DEMO.marketPayload.pools
      .filter((pool) => pool.points.length > 0)
      .map((pool) => pool.id);
    const preferredVisibleIds = preferredIds.filter((id) => availablePoolIds.includes(id));
    return preferredVisibleIds.length > 0 ? preferredVisibleIds : availablePoolIds.slice(0, 2);
  });
  const [showAssetRecordNotes, setShowAssetRecordNotes] = useState(false);
  const [assetRecordGranularity, setAssetRecordGranularity] = useState<"hour" | "day">("hour");

  useEffect(() => {
    const syncDemoWalletState = () => {
      setDemoWalletState(ensureDemoWalletState());
    };

    syncDemoWalletState();
    window.addEventListener(DEMO_WALLET_STATE_CHANGE_EVENT, syncDemoWalletState);
    window.addEventListener("storage", syncDemoWalletState);
    window.addEventListener("focus", syncDemoWalletState);
    return () => {
      window.removeEventListener(DEMO_WALLET_STATE_CHANGE_EVENT, syncDemoWalletState);
      window.removeEventListener("storage", syncDemoWalletState);
      window.removeEventListener("focus", syncDemoWalletState);
    };
  }, []);

  const activeSection = useMemo<HistorySectionView>(() => {
    const raw = searchParams.get("section");
    if (raw === "assets" || raw === "apy" || raw === "summary" || raw === "events" || raw === "decisions") {
      return raw;
    }
    return "assets";
  }, [searchParams]);

  const assetPageKey = `${activeSection}-${assetRecordGranularity}`;
  const [assetPagination, setAssetPagination] = useState<{ key: string; count: number }>({
    key: "assets-hour",
    count: ASSET_RECORD_INITIAL_COUNT,
  });
  const assetVisibleCount =
    assetPagination.key === assetPageKey ? assetPagination.count : ASSET_RECORD_INITIAL_COUNT;

  const hourlyApy = useMemo(
    () =>
      activeSection === "assets" || activeSection === "apy"
        ? buildHourlyBestApy(marketPayload.pools, marketPayload.startMs, marketPayload.endMs)
        : [],
    [activeSection, marketPayload]
  );

  const curve = useMemo(
    () =>
      activeSection === "assets"
        ? buildCurve(flows, decimals, currentAssetsValue, hourlyApy, activeApyPct, marketPayload.endMs)
        : {
            points: [] as Array<[number, number]>,
            depMarks: [] as Array<[number, number]>,
            wdMarks: [] as Array<[number, number]>,
            yMin: 0,
            yMax: 1,
            apyByHour: new Map<number, number>(),
          },
    [activeSection, flows, decimals, currentAssetsValue, hourlyApy, activeApyPct, marketPayload.endMs]
  );

  const flowSeries = useMemo(() => {
    if (activeSection !== "assets") {
      return {
        times: [] as number[],
        depositPrefix: [0],
        withdrawPrefix: [0],
        netPrefix: [0],
      };
    }

    const sorted = [...flows]
      .filter((flow) => Number.isFinite(flow.blockTimeMs) && flow.blockTimeMs > 0)
      .sort((a, b) => (a.blockTimeMs === b.blockTimeMs ? a.logIndex - b.logIndex : a.blockTimeMs - b.blockTimeMs))
      .map((flow) => {
        const amount = asNum(flow.amountRaw, decimals);
        const deposit = flow.kind === "Deposit" ? amount : 0;
        const withdraw = flow.kind === "Withdraw" ? amount : 0;
        return {
          t: flow.blockTimeMs,
          deposit,
          withdraw,
          net: deposit - withdraw,
        };
      });

    const times: number[] = [];
    const depositPrefix = [0];
    const withdrawPrefix = [0];
    const netPrefix = [0];
    for (const item of sorted) {
      times.push(item.t);
      depositPrefix.push(depositPrefix[depositPrefix.length - 1] + item.deposit);
      withdrawPrefix.push(withdrawPrefix[withdrawPrefix.length - 1] + item.withdraw);
      netPrefix.push(netPrefix[netPrefix.length - 1] + item.net);
    }

    return { times, depositPrefix, withdrawPrefix, netPrefix };
  }, [activeSection, flows, decimals]);

  const sortedCurvePoints = useMemo(
    () => (activeSection === "assets" ? [...curve.points].sort((a, b) => a[0] - b[0]) : []),
    [activeSection, curve.points]
  );
  const curveEndMs = useMemo(() => {
    if (activeSection !== "assets") return marketPayload.endMs;
    if (sortedCurvePoints.length === 0) return marketPayload.endMs;
    return Math.max(sortedCurvePoints[sortedCurvePoints.length - 1][0], marketPayload.endMs);
  }, [activeSection, sortedCurvePoints, marketPayload.endMs]);

  const assetChangePage = useMemo(() => {
    if (activeSection !== "assets" || sortedCurvePoints.length === 0) {
      return { rows: [], totalCount: 0 };
    }
    return buildVisibleAssetChangeRows(
      sortedCurvePoints,
      flowSeries,
      curveEndMs,
      assetRecordGranularity,
      assetVisibleCount
    );
  }, [activeSection, sortedCurvePoints, flowSeries, curveEndMs, assetRecordGranularity, assetVisibleCount]);

  const assetChangeRows = assetChangePage.rows;
  const hasMoreAssetChangeRows = assetChangeRows.length < assetChangePage.totalCount;

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedTx = txKeyword.trim().toLowerCase();

    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;

    return rows.filter((row) => {
      if (eventFilter !== "all" && row.eventType !== eventFilter) return false;
      if (row.blockTimeMs < fromMs || row.blockTimeMs > toMs) return false;

      if (normalizedKeyword) {
        const searchText = `${row.summary} ${row.detail} ${eventTypeLabel(row.eventType)}`.toLowerCase();
        if (!searchText.includes(normalizedKeyword)) return false;
      }

      if (normalizedTx && !row.txHash.toLowerCase().includes(normalizedTx)) return false;

      return true;
    });
  }, [rows, eventFilter, keyword, txKeyword, dateFrom, dateTo]);

  const filteredDecisions = useMemo(() => {
    const decisions = [...marketPayload.decisions]
      .filter((decision) => decision.shouldRebalance)
      .sort((a, b) => b.t - a.t);

    return decisions.filter((decision) => {
      if (decisionReasonFilter !== "all" && decision.reason !== decisionReasonFilter) return false;
      return true;
    });
  }, [marketPayload, decisionReasonFilter]);
  const selectedDecisionSet = useMemo(() => new Set(selectedDecisionTs), [selectedDecisionTs]);
  const visibleSelectedDecisionTs = useMemo(
    () => filteredDecisions.filter((decision) => selectedDecisionSet.has(decision.t)).map((decision) => decision.t),
    [filteredDecisions, selectedDecisionSet]
  );
  const allFilteredDecisionsSelected =
    filteredDecisions.length > 0 && visibleSelectedDecisionTs.length === filteredDecisions.length;
  const selectedDecisionTargetTs = visibleSelectedDecisionTs[0] ?? null;
  const latestDecision = useMemo<RebalanceDecisionPayload | null>(() => {
    const decisions = marketPayload.decisions.filter((decision) => decision.shouldRebalance);
    if (decisions.length === 0) return null;
    return decisions.reduce((latest, current) => (current.t > latest.t ? current : latest), decisions[0]);
  }, [marketPayload]);
  const runtimeFeeRateBps = marketPayload.systemProfile?.rebalanceFeeRateBps ?? 5;
  const runtimeFeeMinUsdc =
    marketPayload.systemProfile?.rebalanceFeeMinUsdc ?? marketPayload.systemProfile?.rebalanceFeeUsdc ?? 0;
  const latestFeeExplain = useMemo(() => {
    if (!latestDecision) {
      return `手续费按百分比费率计算：rebalanceFee = max(minFee, assetsBefore × feeRateBps / 10000)。当前 minFee=${runtimeFeeMinUsdc.toFixed(4)} mUSDC（设为 0 时即纯百分比）。`;
    }
    const feeByRate = latestDecision.assetsBefore * (runtimeFeeRateBps / 10_000);
    if (feeByRate <= runtimeFeeMinUsdc) {
      return `当前由最低手续费生效：按费率应为 ${feeByRate.toFixed(6)} mUSDC，低于 minFee ${runtimeFeeMinUsdc.toFixed(4)} mUSDC。`;
    }
    return `当前由百分比费率生效：assetsBefore × feeRate = ${feeByRate.toFixed(6)} mUSDC（显示值按4位小数，视觉上可能接近固定）。`;
  }, [latestDecision, runtimeFeeRateBps, runtimeFeeMinUsdc]);

  const apyPools = useMemo(
    () => (activeSection === "apy" ? marketPayload.pools.filter((pool) => pool.points.length > 0) : []),
    [activeSection, marketPayload]
  );
  const visibleApyPools = useMemo(() => {
    if (activeSection !== "apy") return [];
    const idSet = new Set(selectedApyPoolIds);
    return apyPools.filter((pool) => idSet.has(pool.id));
  }, [activeSection, apyPools, selectedApyPoolIds]);

  const apyLegendNames = useMemo(() => visibleApyPools.map((pool) => pool.name), [visibleApyPools]);

  const apyRange = useMemo(() => {
    if (activeSection !== "apy") return null;
    const allPoints = visibleApyPools.flatMap((pool) => pool.points);
    if (allPoints.length === 0) return null;
    let min = allPoints[0].t;
    let max = allPoints[0].t;
    for (const point of allPoints) {
      if (point.t < min) min = point.t;
      if (point.t > max) max = point.t;
    }
    return { min, max };
  }, [activeSection, visibleApyPools]);

  const apyFocusRange = useMemo(() => {
    if (!apyRange) return null;
    if (!focusDecisionTs) return apyRange;
    return {
      min: Math.max(apyRange.min, focusDecisionTs - 12 * HOUR_MS),
      max: Math.min(apyRange.max, focusDecisionTs + 12 * HOUR_MS),
    };
  }, [apyRange, focusDecisionTs]);

  const focusDecisionApyRows = useMemo(() => {
    if (activeSection !== "apy" || !focusDecisionTs) return [];
    return visibleApyPools
      .map((pool) => ({
        name: pool.name,
        apy: findApyAtOrBefore(pool, focusDecisionTs),
      }))
      .sort((a, b) => b.apy - a.apy);
  }, [activeSection, visibleApyPools, focusDecisionTs]);

  const apyOption = useMemo<Record<string, unknown>>(
    () =>
      activeSection !== "apy"
        ? {}
        : {
            legend: {
              type: "scroll",
              orient: "horizontal",
              data: apyLegendNames,
              top: 0,
              left: 0,
              right: focusDecisionTs ? 76 : 18,
              itemGap: 10,
              textStyle: { color: "rgba(30,41,59,0.9)", fontSize: 11 },
            },
            grid: { left: 56, right: focusDecisionTs ? 76 : 18, top: 56, bottom: 72 },
            tooltip: {
              trigger: "axis",
              formatter: (params: unknown) => {
                const rows = (Array.isArray(params) ? params : [params]) as Array<{
                  axisValue?: number;
                  value?: [number, number];
                  marker: string;
                  seriesName: string;
                }>;
                if (!rows.length) return "";
                const ts = Number(rows[0].axisValue ?? rows[0].value?.[0] ?? 0);
                const lines = [fmtTime(ts)];
                for (const row of rows) {
                  const apy = Number(row.value?.[1] ?? 0);
                  lines.push(`${row.marker}${row.seriesName}: ${apy.toFixed(2)}%`);
                }
                return lines.join("<br/>");
              },
            },
            xAxis: {
              type: "time",
              min: apyFocusRange?.min,
              max: apyFocusRange?.max,
              axisLabel: {
                color: "rgba(71,85,105,0.9)",
                formatter: (v: number) => {
                  const d = new Date(v);
                  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                    d.getDate()
                  ).padStart(2, "0")}\n${String(d.getHours()).padStart(2, "0")}:${String(
                    d.getMinutes()
                  ).padStart(2, "0")}`;
                },
              },
            },
            yAxis: {
              type: "value",
              axisLabel: { color: "rgba(71,85,105,0.9)", formatter: (v: number) => `${v.toFixed(2)}%` },
              splitLine: { lineStyle: { color: "rgba(148,163,184,0.25)" } },
            },
            dataZoom: [{ type: "inside" }, { type: "slider", height: 24, bottom: 14 }],
            series: visibleApyPools.map((pool) => ({
              name: pool.name,
              type: "line",
              smooth: true,
              showSymbol: false,
              lineStyle: { width: 2.1, color: pool.color },
              data: pool.points.map((point) => [point.t, Number(point.apy.toFixed(4))]),
              markLine:
                focusDecisionTs === null
                  ? undefined
                  : {
                      symbol: ["none", "none"],
                      lineStyle: { color: "rgba(239,68,68,0.8)", width: 1.6, type: "dashed" },
                      label: {
                        show: true,
                        formatter: () => fmtFocusTime(focusDecisionTs),
                        position: "end",
                        distance: 14,
                        rotate: 0,
                        align: "right",
                        verticalAlign: "bottom",
                        offset: [-6, -8],
                        color: "rgba(51,65,85,0.96)",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: [6, 10],
                        backgroundColor: "rgba(255,255,255,0.96)",
                        borderColor: "rgba(148,163,184,0.35)",
                        borderWidth: 1,
                        borderRadius: 8,
                      },
                      data: [{ xAxis: focusDecisionTs }],
                    },
            })),
          },
    [activeSection, visibleApyPools, apyLegendNames, apyFocusRange, focusDecisionTs]
  );

  const toggleApyPool = useCallback(
    (poolId: string) => {
      setSelectedApyPoolIds((prev) => {
        const next = prev.includes(poolId) ? prev.filter((id) => id !== poolId) : [...prev, poolId];
        const order = apyPools.map((pool) => pool.id);
        return order.filter((id) => next.includes(id));
      });
    },
    [apyPools]
  );

  const goToHistorySection = useCallback(
    (section: HistorySectionView) => {
      router.push(`${pathname}?section=${section}`, { scroll: false });
    },
    [router, pathname]
  );

  const jumpToDecisionTs = useCallback((ts: number) => {
    setFocusDecisionTs(ts);
    router.push(`${pathname}?section=apy`, { scroll: false });
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const target = document.getElementById("rebalance-apy-chart");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    });
  }, [router, pathname]);
  const toggleDecisionSelection = useCallback((ts: number) => {
    setSelectedDecisionTs((current) =>
      current.includes(ts) ? current.filter((value) => value !== ts) : [...current, ts].sort((a, b) => b - a)
    );
  }, []);
  const toggleAllFilteredDecisions = useCallback(() => {
    setSelectedDecisionTs((current) => {
      const visibleTs = filteredDecisions.map((decision) => decision.t);
      const visibleSet = new Set(visibleTs);
      const currentSet = new Set(current);
      const allSelected = visibleTs.length > 0 && visibleTs.every((ts) => currentSet.has(ts));

      if (allSelected) {
        return current.filter((ts) => !visibleSet.has(ts));
      }

      const nextSet = new Set(current);
      visibleTs.forEach((ts) => nextSet.add(ts));
      return Array.from(nextSet).sort((a, b) => b - a);
    });
  }, [filteredDecisions]);
  const locateSelectedDecision = useCallback(() => {
    if (!selectedDecisionTargetTs) return;
    jumpToDecisionTs(selectedDecisionTargetTs);
  }, [jumpToDecisionTs, selectedDecisionTargetTs]);

  const style: Record<string, CSSProperties> = {
    shell: { display: "grid", gap: 14 },
    card: {
      padding: 18,
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "#ffffff",
      boxShadow: "0 16px 38px rgba(15,23,42,0.08)",
    },
    title: { fontSize: 18, fontWeight: 900, marginBottom: 10 },
    hint: { opacity: 0.86, fontSize: 13, lineHeight: 1.7, color: "rgba(71,85,105,0.9)" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th: {
      textAlign: "left",
      padding: "10px 12px",
      borderBottom: "1px solid rgba(148,163,184,0.35)",
      position: "sticky",
      top: 0,
      background: "rgba(248,250,252,0.98)",
      zIndex: 2,
    },
    td: { padding: "10px 12px", borderBottom: "1px solid rgba(148,163,184,0.25)" },
    mono: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
    },
    err: {
      marginTop: 10,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(251,113,133,0.5)",
      background: "rgba(254,242,242,0.95)",
      color: "#b91c1c",
      fontSize: 13,
    },
    controls: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      alignItems: "center",
      marginBottom: 10,
    },
    protocolBox: {
      marginTop: 10,
      marginBottom: 8,
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "rgba(248,250,252,0.72)",
    },
    protocolTitle: {
      fontSize: 12,
      fontWeight: 800,
      color: "rgba(15,23,42,0.92)",
      marginBottom: 6,
    },
    protocolRow: {
      display: "flex",
      gap: 12,
      flexWrap: "nowrap",
      overflowX: "auto",
      marginBottom: 0,
      paddingBottom: 2,
    },
    protocolItem: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "rgba(51,65,85,0.96)",
      flex: "0 0 auto",
      whiteSpace: "nowrap",
    },
    tabBar: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 8,
    },
    tabBtn: {
      padding: "8px 12px",
      borderRadius: 10,
      border: "1px solid rgba(148,163,184,0.45)",
      background: "rgba(248,250,252,0.9)",
      color: "#334155",
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
    },
    tabBtnActive: {
      border: `1px solid ${PRIMARY_COLOR}`,
      background: PRIMARY_SOFT,
      color: PRIMARY_COLOR,
      boxShadow: "0 10px 22px rgba(15,23,42,0.12)",
    },
    input: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(148,163,184,0.45)",
      background: "#ffffff",
      color: "#0f172a",
      fontSize: 13,
      outline: "none",
    },
    select: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(148,163,184,0.45)",
      background: "#ffffff",
      color: "#0f172a",
      fontSize: 13,
      outline: "none",
    },
    chip: {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      border: "1px solid rgba(148,163,184,0.45)",
      fontSize: 12,
      fontWeight: 700,
    },
    jumpBtn: {
      padding: "4px 8px",
      borderRadius: 8,
      border: "1px solid rgba(0,54,137,0.35)",
      background: "rgba(0,54,137,0.08)",
      color: PRIMARY_COLOR,
      fontSize: 12,
      fontWeight: 800,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    detailsSummary: {
      cursor: "pointer",
      listStyle: "none",
      color: PRIMARY_COLOR,
      fontSize: 13,
      fontWeight: 800,
    },
    textLink: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: 0,
      border: "none",
      background: "transparent",
      color: PRIMARY_COLOR,
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      textDecoration: "underline",
      textUnderlineOffset: 4,
    },
    decisionTopBar: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    decisionTopActions: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      alignItems: "center",
    },
    detailsToggleBtn: {
      display: "inline-flex",
      alignItems: "center",
      padding: 0,
      border: "none",
      background: "transparent",
      color: PRIMARY_COLOR,
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    nowrapTh: {
      textAlign: "left",
      padding: "10px 12px",
      borderBottom: "1px solid rgba(148,163,184,0.35)",
      position: "sticky",
      top: 0,
      background: "rgba(248,250,252,0.98)",
      zIndex: 2,
      whiteSpace: "nowrap",
    },
    checkboxTh: {
      textAlign: "center",
      padding: "10px 10px 10px 12px",
      borderBottom: "1px solid rgba(148,163,184,0.35)",
      position: "sticky",
      top: 0,
      background: "rgba(248,250,252,0.98)",
      zIndex: 2,
      width: 42,
    },
    checkboxCell: {
      padding: "10px 10px 10px 12px",
      borderBottom: "1px solid rgba(148,163,184,0.25)",
      textAlign: "center",
      width: 42,
    },
    selectionInput: {
      width: 14,
      height: 14,
      cursor: "pointer",
    },
    compactMetricCell: {
      padding: "10px 8px",
      borderBottom: "1px solid rgba(148,163,184,0.25)",
      whiteSpace: "nowrap",
    },
    poolNameCell: {
      padding: "10px 12px",
      borderBottom: "1px solid rgba(148,163,184,0.25)",
      whiteSpace: "nowrap",
    },
    loadMoreBox: {
      width: "100%",
      marginTop: 12,
      padding: "12px 14px",
      borderRadius: 14,
      border: "1px dashed rgba(0,54,137,0.32)",
      background: "rgba(239,246,255,0.88)",
      color: PRIMARY_COLOR,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
    },
    loadMoreMeta: {
      fontSize: 12,
      fontWeight: 500,
      color: "rgba(71,85,105,0.9)",
    },
  };

  return (
    <ConsoleLayout title="调仓分析" hidePageHeader>
      <div style={style.shell}>
        <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          {HISTORY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => goToHistorySection(tab.key)}
              className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                activeSection === tab.key
                  ? "bg-[#003689] text-white shadow-sm"
                  : "text-slate-600 hover:bg-[#003689]/10 hover:text-[#003689]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeSection === "assets" ? (
        <div style={style.card}>
          <div style={{ ...style.controls, justifyContent: "space-between", marginBottom: 0 }}>
            <div style={{ ...style.title, marginBottom: 0 }}>资金变化记录</div>
            <div style={{ ...style.controls, marginBottom: 0, justifyContent: "flex-end" }}>
              <select
                style={style.select}
                value={assetRecordGranularity}
                onChange={(e) => setAssetRecordGranularity(e.target.value as "hour" | "day")}
              >
                <option value="hour">按小时</option>
                <option value="day">按天</option>
              </select>
              <button
                type="button"
                style={style.textLink}
                onClick={() => setShowAssetRecordNotes((prev) => !prev)}
              >
                {showAssetRecordNotes ? "收起记录说明" : "查看记录说明"}
              </button>
            </div>
          </div>
          {showAssetRecordNotes ? (
            <>
              <div style={{ ...style.hint, marginTop: 10 }}>
                演示账户 {user}，当前资产 {currentAssetsText} USDC，对应仿真最新区块 {latestBlock.toString()}。
              </div>
              <div style={{ ...style.hint, marginTop: 6 }}>
                可通过右上角切换按小时或按天查看；新增利润 = 期末金额 - 期初金额 - 存入 + 取出。
              </div>
            </>
          ) : null}
          <div style={{ ...style.hint, marginTop: 8 }}>
            存入、取出、累计收益、资金余额的单位为 USDC，新增利润的单位为 10<sup>-4</sup> USDC
          </div>

          {assetChangeRows.length === 0 ? (
            <div style={{ ...style.hint, marginTop: 12 }}>暂无可展示的资金变化记录。</div>
          ) : (
            <>
              <div style={{ maxHeight: 520, overflow: "auto", borderRadius: 12, marginTop: 10 }}>
                <table style={style.table}>
                  <thead>
                    <tr>
                      <th style={style.th}>开始时间</th>
                      <th style={style.th}>结束时间</th>
                      <th style={style.th}>存入</th>
                      <th style={style.th}>取出</th>
                      <th style={style.th}>新增利润</th>
                      <th style={style.th}>累计收益</th>
                      <th style={style.th}>资金余额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetChangeRows.map((row) => (
                      <tr key={row.key}>
                        <td style={style.td}>{fmtTime(row.fromMs)}</td>
                        <td style={style.td}>{fmtTime(row.toMs)}</td>
                        <td style={style.td}>{formatDisplayUsdc(row.deposit)}</td>
                        <td style={style.td}>{formatDisplayUsdc(row.withdraw)}</td>
                        <td style={style.td}>{formatDisplayTenNeg4(row.newInterest)}</td>
                        <td style={style.td}>{formatDisplayUsdc(row.cumulativeInterest)}</td>
                        <td style={style.td}>{formatDisplayUsdc(row.cumulativeAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMoreAssetChangeRows ? (
                <button
                  type="button"
                  style={style.loadMoreBox}
                  onClick={() =>
                    setAssetPagination((prev) => ({
                      key: assetPageKey,
                      count:
                        (prev.key === assetPageKey ? prev.count : ASSET_RECORD_INITIAL_COUNT) +
                        ASSET_RECORD_BATCH_COUNT,
                    }))
                  }
                >
                  <span>加载更多</span>
                  <span style={style.loadMoreMeta}>
                    当前显示 {assetChangeRows.length} / {assetChangePage.totalCount} 条
                  </span>
                </button>
              ) : null}
            </>
          )}
        </div>
        ) : null}

        {activeSection === "apy" ? (
        <div id="rebalance-apy-chart" style={style.card}>
          <div style={style.title}>历史利率曲线</div>
          <div style={style.protocolBox}>
            <div style={style.protocolTitle}>协议筛选</div>
            <div style={style.protocolRow}>
              {apyPools.map((pool) => (
                <label key={pool.id} style={style.protocolItem}>
                  <input
                    type="checkbox"
                    checked={selectedApyPoolIds.includes(pool.id)}
                    onChange={() => toggleApyPool(pool.id)}
                  />
                  <span>{pool.name}</span>
                </label>
              ))}
            </div>
            {visibleApyPools.length === 0 ? (
              <div style={{ ...style.hint, marginTop: 2 }}>当前未选择协议，请至少勾选一个。</div>
            ) : null}
          </div>
          <ReactECharts option={apyOption} style={{ height: 420, width: "100%", marginTop: 10 }} notMerge />
          {focusDecisionTs ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ ...style.hint, marginBottom: 6 }}>当前定位时刻：{fmtTime(focusDecisionTs)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {focusDecisionApyRows.map((row) => (
                  <span key={row.name} style={style.chip}>{`${row.name}: ${row.apy.toFixed(2)}%`}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeSection === "summary" ? (
        <div style={style.card}>
          <div style={style.title}>调仓决策摘要</div>
          {latestDecision ? (
            <div style={{ ...style.controls, marginBottom: 0 }}>
              <div style={{ ...style.chip, borderColor: "rgba(148,163,184,0.45)" }}>
                时间：{fmtTime(latestDecision.t)}
              </div>
              <div style={{ ...style.chip, borderColor: "rgba(148,163,184,0.45)" }}>
                预期增益：{latestDecision.expectedGain.toFixed(4)} mUSDC
              </div>
              <div style={{ ...style.chip, borderColor: "rgba(148,163,184,0.45)" }}>
                手续费：{latestDecision.rebalanceFee.toFixed(4)} mUSDC
              </div>
              <div
                style={{
                  ...style.chip,
                  borderColor: latestDecision.shouldRebalance ? PRIMARY_COLOR : "rgba(148,163,184,0.45)",
                  background: latestDecision.shouldRebalance ? PRIMARY_SOFT : "transparent",
                  color: latestDecision.shouldRebalance ? PRIMARY_COLOR : "#334155",
                }}
              >
                结论：{latestDecision.shouldRebalance ? "执行调仓" : "保持仓位"}
              </div>
              <div style={{ ...style.hint, width: "100%" }}>
                原因：{decisionReasonLabel(latestDecision.reason)}。池子迁移：{latestDecision.activePoolName} →
                {latestDecision.bestPoolName}，APY 差值 {(latestDecision.deltaBps / 100).toFixed(2)}%。
              </div>
            </div>
          ) : (
            <div style={style.hint}>暂无可展示的调仓决策摘要。</div>
          )}
        </div>
        ) : null}

        {activeSection === "events" ? (
        <div style={style.card}>
          <div style={style.title}>链上事件</div>
          <details style={{ marginBottom: 10 }}>
            <summary style={style.detailsSummary}>展开筛选条件</summary>
            <div style={{ ...style.controls, marginTop: 10 }}>
              <select style={style.select} value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
                <option value="all">全部事件</option>
                <option value="Rebalanced">调仓</option>
                <option value="PoolAPYUpdated">APY 更新</option>
                <option value="ActivePoolUpdated">主池切换</option>
                <option value="Deposit">存入</option>
                <option value="Withdraw">取出</option>
              </select>
              <input
                style={style.input}
                placeholder="关键词（摘要/详情）"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <input
                style={style.input}
                placeholder="交易哈希"
                value={txKeyword}
                onChange={(e) => setTxKeyword(e.target.value)}
              />
              <input
                style={style.input}
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <input style={style.input} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </details>

          <div style={{ ...style.hint, marginBottom: 10 }}>
            以下为本地生成的仿真事件流，字段结构与真实链上事件表保持一致。
          </div>

          {filteredRows.length === 0 ? (
            <div style={style.hint}>当前筛选条件下无事件。</div>
          ) : (
            <div style={{ maxHeight: 440, overflow: "auto", borderRadius: 12 }}>
              <table style={style.table}>
                <thead>
                  <tr>
                    <th style={style.th}>时间</th>
                    <th style={style.th}>块高</th>
                    <th style={style.th}>事件</th>
                    <th style={style.th}>摘要</th>
                    <th style={style.th}>详情</th>
                    <th style={style.th}>交易哈希</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td style={style.td}>{fmtTime(row.blockTimeMs)}</td>
                      <td style={style.td}>{row.blockNumber.toString()}</td>
                      <td style={style.td}>{eventTypeLabel(row.eventType)}</td>
                      <td style={style.td}>{row.summary}</td>
                      <td style={style.td}>{row.detail}</td>
                      <td style={{ ...style.td, ...style.mono }}>{compactHash(row.txHash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        ) : null}

        {activeSection === "decisions" ? (
        <div style={style.card}>
          <div style={style.title}>调仓记录</div>
          <div style={style.decisionTopBar}>
            <div style={style.decisionTopActions}>
              <button type="button" style={style.detailsToggleBtn} onClick={() => setDecisionFiltersOpen((prev) => !prev)}>
                {decisionFiltersOpen ? "收起筛选条件" : "展开筛选条件"}
              </button>
              <button
                type="button"
                style={{
                  ...style.jumpBtn,
                  opacity: selectedDecisionTargetTs ? 1 : 0.45,
                  cursor: selectedDecisionTargetTs ? "pointer" : "not-allowed",
                }}
                disabled={!selectedDecisionTargetTs}
                onClick={locateSelectedDecision}
              >
                定位到该时刻
              </button>
            </div>
            <span style={style.hint}>总数：{filteredDecisions.length}</span>
          </div>
          {decisionFiltersOpen ? (
            <div style={{ ...style.controls, marginTop: 0, marginBottom: 12 }}>
              <select
                style={style.select}
                value={decisionReasonFilter}
                onChange={(e) => setDecisionReasonFilter(e.target.value)}
              >
                <option value="all">全部原因</option>
                <option value="rebalance_executed">执行调仓</option>
              </select>
            </div>
          ) : null}

          {filteredDecisions.length === 0 ? (
            <div style={style.hint}>暂无可展示的仿真决策数据。</div>
          ) : (
            <div style={{ maxHeight: 460, overflow: "auto", borderRadius: 12 }}>
              <table style={{ ...style.table, width: "auto", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={style.checkboxTh}>
                      <input
                        type="checkbox"
                        style={style.selectionInput}
                        aria-label="全选调仓记录"
                        checked={allFilteredDecisionsSelected}
                        onChange={toggleAllFilteredDecisions}
                      />
                    </th>
                    <th style={style.nowrapTh}>时间</th>
                    <th style={style.nowrapTh}>当前池</th>
                    <th style={style.nowrapTh}>最优池</th>
                    <th style={style.nowrapTh}>APY差值 (%)</th>
                    <th style={{ ...style.nowrapTh, padding: "10px 8px" }}>预期增益 (mUSDC)</th>
                    <th style={{ ...style.nowrapTh, padding: "10px 8px" }}>手续费 (mUSDC)</th>
                    <th style={style.nowrapTh}>调仓结论</th>
                    <th style={style.nowrapTh}>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDecisions.map((decision: RebalanceDecisionPayload) => (
                    <tr key={decision.t}>
                      <td style={style.checkboxCell}>
                        <input
                          type="checkbox"
                          style={style.selectionInput}
                          aria-label={`选择 ${fmtTime(decision.t)} 的调仓记录`}
                          checked={selectedDecisionSet.has(decision.t)}
                          onChange={() => toggleDecisionSelection(decision.t)}
                        />
                      </td>
                      <td style={style.td}>{fmtTime(decision.t)}</td>
                      <td style={style.poolNameCell}>
                        {fmtDecisionPoolName(decision.activePoolName)}
                        <div style={style.hint}>{decision.activeApy.toFixed(2)}%</div>
                      </td>
                      <td style={style.poolNameCell}>
                        {fmtDecisionPoolName(decision.bestPoolName)}
                        <div style={style.hint}>{decision.bestApy.toFixed(2)}%</div>
                      </td>
                      <td style={style.td}>{(decision.deltaBps / 100).toFixed(2)}%</td>
                      <td style={style.compactMetricCell}>{decision.expectedGain.toFixed(4)}</td>
                      <td style={style.compactMetricCell}>{decision.rebalanceFee.toFixed(4)}</td>
                      <td style={style.td}>
                        <span style={style.chip}>调仓</span>
                      </td>
                      <td style={style.td}>{decisionReasonLabel(decision.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ ...style.hint, marginTop: 8 }}>
            规则说明：当且仅当“预期增益 &gt; 手续费”时执行调仓；否则保持当前仓位。手续费模型为
            max(minFee, assetsBefore × feeRateBps / 10000)，当前配置 feeRateBps={runtimeFeeRateBps.toFixed(2)}，
            minFee={runtimeFeeMinUsdc.toFixed(4)} mUSDC。
            {" "}
            {latestFeeExplain}
          </div>
        </div>
        ) : null}
      </div>
    </ConsoleLayout>
  );
}

function HistoryPageFallback() {
  return (
    <ConsoleLayout title="调仓分析" hidePageHeader>
      <section
        style={{
          padding: 18,
          borderRadius: 18,
          border: "1px solid rgba(148,163,184,0.35)",
          background: "#ffffff",
          boxShadow: "0 16px 38px rgba(15,23,42,0.08)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>调仓分析加载中</div>
        <div style={{ opacity: 0.86, fontSize: 13, lineHeight: 1.7, color: "rgba(71,85,105,0.9)" }}>
          正在准备当前二级模块内容，请稍候。
        </div>
      </section>
    </ConsoleLayout>
  );
}

