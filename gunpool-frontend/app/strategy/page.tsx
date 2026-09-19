"use client";

import dynamic from "next/dynamic";
import { Suspense, useMemo, useState, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PublicLayout } from "@/src/components/layout/public-layout";
import type { MarketApyApiPayload } from "@/src/lib/market-api-types";

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

type StrategyKey = "best_apy" | "delta_threshold" | "stability_first";
type RiskLevel = "low" | "medium" | "high";

type SimulationConfig = {
  frequencyMinutes: number;
  windowHours: number;
  strategy: StrategyKey;
  feeRateBps: number;
  feeMinUsdc: number;
  startAssets: number;
  gasPerRebalanceUsdc: number;
};

type AssumptionSet = Pick<
  SimulationConfig,
  "startAssets" | "feeRateBps" | "feeMinUsdc" | "gasPerRebalanceUsdc"
>;

type SimulationResult = {
  key: string;
  label: string;
  finalAssets: number;
  netGain: number;
  netReturnPct: number;
  rebalanceCount: number;
  totalFees: number;
  stabilityScore: number;
  maxDrawdownPct: number;
  worstDayReturnPct: number;
  rebalancePerDay: number;
  overRebalanceHint: string;
  riskLevel: RiskLevel;
};

type HoldComparisonRow = {
  key: string;
  label: string;
  finalAssets: number;
  netGain: number;
  netReturnPct: number;
  note: string;
  isSystem: boolean;
};

type DemoDisplayRow = {
  chartLabel: string;
  row: SimulationResult;
};

type StrategySectionView = "params" | "hold" | "frequency" | "algorithm" | "window";

const STRATEGY_COMPARE_TABS: Array<{
  key: Exclude<StrategySectionView, "params">;
  label: string;
}> = [
  { key: "hold", label: "单池持有对比" },
  { key: "algorithm", label: "策略算法对比" },
  { key: "frequency", label: "调仓频率对比" },
  { key: "window", label: "收益覆盖窗口对比" },
];

const YEAR_HOURS = 24 * 365;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LOOKBACK_DAYS = 365;
const LOOKBACK_MS = LOOKBACK_DAYS * DAY_MS;
const DEFAULT_PRINCIPAL = 1000;
const DEFAULT_FEE_RATE_BPS = 5;
const DEFAULT_FEE_MIN_USDC = 0;
const DEFAULT_GAS_ASSUMPTION = 0.01;

const STRATEGY_LABEL: Record<StrategyKey, string> = {
  best_apy: "最高 APY 优先",
  delta_threshold: "阈值过滤（ΔAPY≥0.30%）",
  stability_first: "平滑优先（6h均值）",
};

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function fmtNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function fmtInputNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(digits)));
}

function scaleDemoValue(baseValue: number, startAssets: number): number {
  const safeAssets = Number.isFinite(startAssets) && startAssets > 0 ? startAssets : DEFAULT_PRINCIPAL;
  return Number(((baseValue * safeAssets) / DEFAULT_PRINCIPAL).toFixed(2));
}

function buildDemoDisplayRows(
  specs: Array<{
    key: string;
    chartLabel: string;
    label: string;
    netGainBase: number;
    rebalanceCount: number;
    totalFeesBase: number;
    stabilityScore: number;
    maxDrawdownPct: number;
    worstDayReturnPct: number;
    rebalancePerDay: number;
    overRebalanceHint: string;
    riskLevel: RiskLevel;
  }>,
  startAssets: number
): DemoDisplayRow[] {
  const safeAssets = Number.isFinite(startAssets) && startAssets > 0 ? startAssets : DEFAULT_PRINCIPAL;

  return specs.map((spec) => {
    const netGain = scaleDemoValue(spec.netGainBase, safeAssets);
    const totalFees = scaleDemoValue(spec.totalFeesBase, safeAssets);
    const finalAssets = Number((safeAssets + netGain).toFixed(4));
    const netReturnPct = safeAssets > 0 ? Number(((netGain / safeAssets) * 100).toFixed(2)) : 0;

    return {
      chartLabel: spec.chartLabel,
      row: {
        key: spec.key,
        label: spec.label,
        finalAssets,
        netGain,
        netReturnPct,
        rebalanceCount: spec.rebalanceCount,
        totalFees,
        stabilityScore: spec.stabilityScore,
        maxDrawdownPct: spec.maxDrawdownPct,
        worstDayReturnPct: spec.worstDayReturnPct,
        rebalancePerDay: spec.rebalancePerDay,
        overRebalanceHint: spec.overRebalanceHint,
        riskLevel: spec.riskLevel,
      },
    };
  });
}

// 生成仿真APY数据点，无需调用真实API
function buildMockPayload(): import("@/src/lib/market-api-types").MarketApyApiPayload {
  const now = Date.now();
  const DAY = 86_400_000;
  const start = now - 365 * DAY;

  // 伪随机种子函数，确保数据稳定（每次渲染相同）
  function seededRand(seed: number, offset: number): number {
    const x = Math.sin(seed * 9301 + offset * 49297 + 233) * 93647.3;
    return x - Math.floor(x);
  }

  const poolDefs = [
    { id: "aave-v3-usdc", name: "Aave V3 USDC", project: "Aave", symbol: "USDC", color: "#6366f1", baseApy: 4.8 },
    { id: "compound-v3-usdc", name: "Compound V3 USDC", project: "Compound", symbol: "USDC", color: "#22c55e", baseApy: 3.9 },
    { id: "venus-usdc", name: "Venus USDC", project: "Venus", symbol: "USDC", color: "#f59e0b", baseApy: 5.2 },
  ];

  const pools = poolDefs.map((def, poolIdx) => {
    const points: { t: number; apy: number }[] = [];
    for (let day = 0; day <= 365; day++) {
      const t = start + day * DAY;
      const trend = Math.sin((day / 365) * Math.PI * 3 + poolIdx) * 1.2;
      const noise = (seededRand(day, poolIdx) - 0.5) * 1.0;
      const apy = Math.max(1.0, def.baseApy + trend + noise);
      points.push({ t, apy: Number(apy.toFixed(3)) });
    }
    return { id: def.id, name: def.name, project: def.project, symbol: def.symbol, color: def.color, points };
  });

  return {
    ok: true,
    startMs: start,
    endMs: now,
    updatedAt: now,
    pools,
    decisions: [],
    systemProfile: {
      fetchRetry: 3,
      fetchTimeoutMs: 8000,
      fetchConcurrency: 3,
      rebalanceWindowSeconds: 86400,
      rebalanceFeeRateBps: 5,
      rebalanceFeeMinUsdc: 0,
      rebalanceFeeUsdc: 0,
      strategyStartAssets: 1000,
      database: "mock",
      startDate: new Date(start).toISOString().slice(0, 10),
      antiCrawler: "none",
    },
  };
}

function parseNonNegativeInput(raw: string, fallback: number, min = 0): number {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return Math.max(min, fallback);
  return Math.max(min, parsed);
}

type PreparedPoolSeries = {
  id: string;
  name: string;
  apyByHour: Float64Array;
  prefixApy: Float64Array;
  prefixLogGrowth: Float64Array;
};

type SimulationContext = {
  pools: PreparedPoolSeries[];
  startMs: number;
  endMs: number;
  startHourMs: number;
  hourCount: number;
};

function toHourMs(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function clampIndex(idx: number, max: number): number {
  if (max <= 0) return 0;
  if (!Number.isFinite(idx)) return 0;
  return Math.min(Math.max(0, idx), max);
}

function buildSimulationContext(payload: MarketApyApiPayload | null): SimulationContext | null {
  if (!payload) return null;
  const sourcePools = payload.pools.filter((pool) => pool.points.length > 0);
  if (sourcePools.length === 0) return null;

  const rawEndMs = payload.endMs || Date.now();
  const endMs = Number.isFinite(rawEndMs) ? rawEndMs : Date.now();
  const lookbackStartMs = endMs - LOOKBACK_MS;
  const datasetStartMs = Number.isFinite(payload.startMs) ? payload.startMs : lookbackStartMs;
  const startMs = Math.min(endMs, Math.max(datasetStartMs, lookbackStartMs));

  const startHourMs = toHourMs(startMs);
  const endHourMs = Math.max(startHourMs, toHourMs(endMs));
  const hourCount = Math.max(1, Math.floor((endHourMs - startHourMs) / HOUR_MS) + 1);

  const pools: PreparedPoolSeries[] = sourcePools.map((pool) => {
    const points = [...pool.points].sort((a, b) => a.t - b.t);
    const apyByHour = new Float64Array(hourCount);
    const prefixApy = new Float64Array(hourCount + 1);
    const prefixLogGrowth = new Float64Array(hourCount + 1);

    let pointIndex = 0;
    let currentApy = points[0]?.apy ?? 0;

    for (let hourIdx = 0; hourIdx < hourCount; hourIdx++) {
      const hourMs = startHourMs + hourIdx * HOUR_MS;
      while (pointIndex + 1 < points.length && points[pointIndex + 1].t <= hourMs) {
        pointIndex += 1;
      }
      const pointApy = points[pointIndex]?.apy;
      if (Number.isFinite(pointApy)) currentApy = pointApy;

      const safeApy = Number.isFinite(currentApy) ? currentApy : 0;
      const perHourRate = Math.max(-0.999999, safeApy / 100 / YEAR_HOURS);
      apyByHour[hourIdx] = safeApy;
      prefixApy[hourIdx + 1] = prefixApy[hourIdx] + safeApy;
      prefixLogGrowth[hourIdx + 1] = prefixLogGrowth[hourIdx] + Math.log1p(perHourRate);
    }

    return {
      id: pool.id,
      name: pool.name,
      apyByHour,
      prefixApy,
      prefixLogGrowth,
    };
  });

  return {
    pools,
    startMs,
    endMs,
    startHourMs,
    hourCount,
  };
}

function meanApyFromPrefix(pool: PreparedPoolSeries, hourIdx: number, lookbackHours: number): number {
  const endExclusive = clampIndex(hourIdx, pool.apyByHour.length - 1) + 1;
  const size = Math.max(1, Math.round(lookbackHours));
  const startInclusive = Math.max(0, endExclusive - size);
  const total = pool.prefixApy[endExclusive] - pool.prefixApy[startInclusive];
  const count = Math.max(1, endExclusive - startInclusive);
  return total / count;
}

function projectedGainFromWindow(
  context: SimulationContext,
  assets: number,
  activeIndex: number,
  candidateIndex: number,
  hourIdx: number,
  windowHours: number
): number {
  const startInclusive = clampIndex(hourIdx, context.hourCount - 1);
  const lookAheadHours = Math.max(1, Math.round(windowHours));
  const endExclusive = Math.max(
    startInclusive + 1,
    Math.min(context.hourCount, startInclusive + lookAheadHours)
  );

  const activePool = context.pools[activeIndex];
  const candidatePool = context.pools[candidateIndex];
  const activeLog =
    activePool.prefixLogGrowth[endExclusive] - activePool.prefixLogGrowth[startInclusive];
  const candidateLog =
    candidatePool.prefixLogGrowth[endExclusive] - candidatePool.prefixLogGrowth[startInclusive];

  const activeFactor = Math.exp(activeLog);
  const candidateFactor = Math.exp(candidateLog);
  const gainFactor = Math.max(0, candidateFactor - activeFactor);
  return assets * gainFactor;
}

function growthFactorForRange(
  context: SimulationContext,
  poolIndex: number,
  fromMs: number,
  toMs: number
): number {
  if (toMs <= fromMs) return 1;

  const apyByHour = context.pools[poolIndex].apyByHour;
  let factor = 1;
  let cursor = fromMs;

  while (cursor < toMs) {
    const hourIdx = clampIndex(
      Math.floor((cursor - context.startHourMs) / HOUR_MS),
      context.hourCount - 1
    );
    const hourEndMs = Math.min(toMs, context.startHourMs + (hourIdx + 1) * HOUR_MS);
    const apy = apyByHour[hourIdx] ?? 0;
    const perHourRate = Math.max(-0.999999, apy / 100 / YEAR_HOURS);
    factor *= Math.pow(1 + perHourRate, (hourEndMs - cursor) / HOUR_MS);
    cursor = hourEndMs;
  }

  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return factor;
}
function riskLevelFromMetrics(maxDrawdownPct: number, worstDayReturnPct: number, rebalancePerDay: number): RiskLevel {
  if (maxDrawdownPct <= 3 && worstDayReturnPct >= -0.8 && rebalancePerDay <= 4) return "low";
  if (maxDrawdownPct <= 8 && worstDayReturnPct >= -2 && rebalancePerDay <= 12) return "medium";
  return "high";
}

function overRebalanceHintFromFrequency(rebalancePerDay: number): string {
  if (rebalancePerDay >= 24) return "过度调仓明显（约每小时 1 次或更多）。";
  if (rebalancePerDay >= 12) return "调仓偏频繁，收益更依赖成本控制。";
  if (rebalancePerDay >= 6) return "调仓频率中等，建议关注手续费与Gas。";
  return "调仓频率可控。";
}

function runSimulation(context: SimulationContext | null, config: SimulationConfig): SimulationResult {
  const pools = context?.pools ?? [];
  if (!context || pools.length === 0) {
    return {
      key: "empty",
      label: "No data",
      finalAssets: config.startAssets,
      netGain: 0,
      netReturnPct: 0,
      rebalanceCount: 0,
      totalFees: 0,
      stabilityScore: 0,
      maxDrawdownPct: 0,
      worstDayReturnPct: 0,
      rebalancePerDay: 0,
      overRebalanceHint: "No data.",
      riskLevel: "low",
    };
  }

  const stepMs = Math.max(60_000, config.frequencyMinutes * 60_000);
  const { startMs, endMs } = context;
  const feeRate = config.feeRateBps / 10_000;
  const gasCost = Math.max(0, config.gasPerRebalanceUsdc);

  let assets = config.startAssets;
  let fees = 0;
  let rebalanceCount = 0;
  let activeIndex = 0;
  let apyJumpAbs = 0;
  let jumpCount = 0;

  let peakAssets = Math.max(assets, 0);
  let maxDrawdownPct = 0;
  const dailyCloseByDay = new Map<number, number>();
  dailyCloseByDay.set(Math.floor(startMs / DAY_MS) * DAY_MS, assets);

  function trackDrawdown() {
    if (assets > peakAssets) {
      peakAssets = assets;
      return;
    }
    if (peakAssets <= 0) return;
    const drawdown = ((peakAssets - assets) / peakAssets) * 100;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  const startHourIdx = clampIndex(
    Math.floor((startMs - context.startHourMs) / HOUR_MS),
    context.hourCount - 1
  );
  let bestInit = 0;
  for (let i = 1; i < pools.length; i++) {
    if (pools[i].apyByHour[startHourIdx] > pools[bestInit].apyByHour[startHourIdx]) bestInit = i;
  }
  activeIndex = bestInit;

  for (let t = startMs; t < endMs; t += stepMs) {
    const hourIdx = clampIndex(
      Math.floor((t - context.startHourMs) / HOUR_MS),
      context.hourCount - 1
    );

    const apys = pools.map((pool) => pool.apyByHour[hourIdx] ?? 0);
    const activeApy = apys[activeIndex] ?? 0;

    let candidate = activeIndex;
    if (config.strategy === "stability_first") {
      let bestAvg = meanApyFromPrefix(pools[activeIndex], hourIdx, 6);
      for (let i = 0; i < pools.length; i++) {
        const avg = meanApyFromPrefix(pools[i], hourIdx, 6);
        if (avg > bestAvg) {
          bestAvg = avg;
          candidate = i;
        }
      }
    } else {
      for (let i = 0; i < pools.length; i++) {
        if (apys[i] > apys[candidate]) candidate = i;
      }
    }

    const candidateApy = apys[candidate] ?? activeApy;
    const deltaBps = Math.max(0, Math.round((candidateApy - activeApy) * 100));
    const expectedGain = projectedGainFromWindow(
      context,
      assets,
      activeIndex,
      candidate,
      hourIdx,
      config.windowHours
    );
    const fee = Math.max(config.feeMinUsdc, assets * feeRate);
    const rebalanceCost = fee + gasCost;
    const thresholdOk = config.strategy !== "delta_threshold" || deltaBps >= 30;
    const canRebalance = candidate !== activeIndex && thresholdOk && expectedGain > rebalanceCost;

    if (canRebalance) {
      activeIndex = candidate;
      assets = Math.max(0, assets - rebalanceCost);
      fees += rebalanceCost;
      rebalanceCount += 1;
      apyJumpAbs += Math.abs(candidateApy - activeApy);
      jumpCount += 1;
      trackDrawdown();
    }

    const nextT = Math.min(endMs, t + stepMs);
    const growthFactor = growthFactorForRange(context, activeIndex, t, nextT);
    assets = Math.max(0, assets * growthFactor);
    trackDrawdown();
    dailyCloseByDay.set(Math.floor(nextT / DAY_MS) * DAY_MS, assets);
  }

  const netGain = assets - config.startAssets;
  const netReturnPct = config.startAssets > 0 ? (netGain / config.startAssets) * 100 : 0;
  const avgJump = jumpCount > 0 ? apyJumpAbs / jumpCount : 0;
  const stabilityScore = Math.max(
    0,
    100 - Math.min(100, rebalanceCount * 1.8 + avgJump * 8 + maxDrawdownPct * 3)
  );

  const sortedDailyCloses = [...dailyCloseByDay.entries()].sort((a, b) => a[0] - b[0]);
  let prevClose = config.startAssets;
  let worstDayReturnPct = 0;
  for (const [, close] of sortedDailyCloses) {
    if (prevClose <= 0) {
      prevClose = close;
      continue;
    }
    const dayReturn = ((close - prevClose) / prevClose) * 100;
    if (dayReturn < worstDayReturnPct) worstDayReturnPct = dayReturn;
    prevClose = close;
  }

  const durationDays = Math.max(1, (endMs - startMs) / DAY_MS);
  const rebalancePerDay = rebalanceCount / durationDays;
  const overRebalanceHint = overRebalanceHintFromFrequency(rebalancePerDay);
  const riskLevel = riskLevelFromMetrics(maxDrawdownPct, worstDayReturnPct, rebalancePerDay);

  return {
    key: `${config.frequencyMinutes}-${config.windowHours}-${config.strategy}`,
    label: `${config.frequencyMinutes}m / ${config.windowHours}h / ${STRATEGY_LABEL[config.strategy]}`,
    finalAssets: Number(assets.toFixed(4)),
    netGain: Number(netGain.toFixed(4)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    rebalanceCount,
    totalFees: Number(fees.toFixed(4)),
    stabilityScore: Number(stabilityScore.toFixed(1)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    worstDayReturnPct: Number(worstDayReturnPct.toFixed(2)),
    rebalancePerDay: Number(rebalancePerDay.toFixed(2)),
    overRebalanceHint,
    riskLevel,
  };
}

function runSinglePoolHold365(
  context: SimulationContext | null,
  poolIndex: number,
  startAssets: number
): HoldComparisonRow | null {
  if (!context || poolIndex < 0 || poolIndex >= context.pools.length) return null;

  const pool = context.pools[poolIndex];
  const factor = growthFactorForRange(context, poolIndex, context.startMs, context.endMs);
  const finalAssets = Math.max(0, startAssets * factor);
  const netGain = finalAssets - startAssets;
  const netReturnPct = startAssets > 0 ? (netGain / startAssets) * 100 : 0;

  return {
    key: `hold-${pool.id}`,
    label: `${pool.name}（单池持有）`,
    finalAssets: Number(finalAssets.toFixed(4)),
    netGain: Number(netGain.toFixed(4)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    note: "固定持有，不调仓，不计调仓手续费和Gas",
    isSystem: false,
  };
}

function rankByNetGain(a: SimulationResult, b: SimulationResult): number {
  return b.netGain - a.netGain;
}

function pickRecommended(rows: SimulationResult[]): SimulationResult | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const netDiff = b.netGain - a.netGain;
    if (Math.abs(netDiff) > 1e-9) return netDiff;
    const riskDiff = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.rebalanceCount - b.rebalanceCount;
  })[0];
}

export default function StrategyPage() {
  return (
    <PublicLayout>
      <Suspense fallback={<StrategyPageFallback />}>
        <StrategyPageContent />
      </Suspense>
    </PublicLayout>
  );
}

function StrategyPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 使用仿真数据，无需API调用，页面立即响应
  const [payload] = useState<MarketApyApiPayload>(() => buildMockPayload());
  const [error] = useState("");

  const [principalInput, setPrincipalInput] = useState(fmtInputNumber(DEFAULT_PRINCIPAL, 2));
  const [feeRateInput, setFeeRateInput] = useState(fmtInputNumber(DEFAULT_FEE_RATE_BPS, 2));
  const [feeMinInput, setFeeMinInput] = useState(fmtInputNumber(DEFAULT_FEE_MIN_USDC, 4));
  const [gasInput, setGasInput] = useState(fmtInputNumber(DEFAULT_GAS_ASSUMPTION, 4));
  const [appliedAssumptions, setAppliedAssumptions] = useState<AssumptionSet>({
    startAssets: DEFAULT_PRINCIPAL,
    feeRateBps: DEFAULT_FEE_RATE_BPS,
    feeMinUsdc: DEFAULT_FEE_MIN_USDC,
    gasPerRebalanceUsdc: DEFAULT_GAS_ASSUMPTION,
  });
  const [holdView, setHoldView] = useState<"chart" | "table">("chart");
  const [frequencyView, setFrequencyView] = useState<"chart" | "table">("chart");
  const [strategyView, setStrategyView] = useState<"chart" | "table">("chart");
  const [windowView, setWindowView] = useState<"chart" | "table">("chart");

  // 收益覆盖窗口 — 时间范围选择器
  const todayStr = useMemo(() => {
    const d = new Date(payload.updatedAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [payload.updatedAt]);
  const weekAgoStr = useMemo(() => {
    const d = new Date(payload.updatedAt - 2 * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [payload.updatedAt]);
  const [windowDateFrom, setWindowDateFrom] = useState(weekAgoStr);
  const [windowDateTo, setWindowDateTo] = useState(todayStr);
  const [freqDateFrom, setFreqDateFrom] = useState(weekAgoStr);
  const [freqDateTo, setFreqDateTo] = useState(todayStr);

  const freqSelectedHours = useMemo(() => {
    if (!freqDateFrom || !freqDateTo) return 48;
    const from = new Date(`${freqDateFrom}T00:00:00`).getTime();
    const to = new Date(`${freqDateTo}T23:59:59`).getTime();
    const hours = Math.max(1, Math.round((to - from) / 3_600_000));
    return hours;
  }, [freqDateFrom, freqDateTo]);

  const freqMatchedKey = useMemo(() => {
    const h = freqSelectedHours;
    if (h <= 24) return "demo-frequency-10m";
    if (h <= 72) return "demo-frequency-30m";
    if (h <= 168) return "demo-frequency-1h";
    return "demo-frequency-2h";
  }, [freqSelectedHours]);

  const windowSelectedHours = useMemo(() => {
    if (!windowDateFrom || !windowDateTo) return 48;
    const from = new Date(`${windowDateFrom}T00:00:00`).getTime();
    const to = new Date(`${windowDateTo}T23:59:59`).getTime();
    const hours = Math.max(1, Math.round((to - from) / 3_600_000));
    return hours;
  }, [windowDateFrom, windowDateTo]);

  const windowMatchedKey = useMemo(() => {
    const h = windowSelectedHours;
    if (h <= 18) return "demo-window-12h";
    if (h <= 36) return "demo-window-24h";
    if (h <= 72) return "demo-window-48h";
    return "demo-window-96h";
  }, [windowSelectedHours]);

  // 仿真数据在 useState 初始化时已同步生成，无需 useEffect 异步加载

  const baseline = useMemo(() => {
    const profile = payload.systemProfile;
    return {
      feeRateBps: Number(profile?.rebalanceFeeRateBps ?? 5),
      feeMinUsdc: Number(profile?.rebalanceFeeMinUsdc ?? profile?.rebalanceFeeUsdc ?? 0),
      startAssets: Number(profile?.strategyStartAssets ?? 1000),
    };
  }, [payload.systemProfile]);

  const draftAssumptions = useMemo(
    () => ({
      startAssets: parseNonNegativeInput(principalInput, appliedAssumptions.startAssets, 0),
      feeRateBps: parseNonNegativeInput(feeRateInput, appliedAssumptions.feeRateBps, 0),
      feeMinUsdc: parseNonNegativeInput(feeMinInput, appliedAssumptions.feeMinUsdc, 0),
      gasPerRebalanceUsdc: parseNonNegativeInput(gasInput, appliedAssumptions.gasPerRebalanceUsdc, 0),
    }),
    [principalInput, feeRateInput, feeMinInput, gasInput, appliedAssumptions]
  );

  const assumptions = appliedAssumptions;
  const simulationContext = useMemo(() => buildSimulationContext(payload), [payload]);

  const hasPendingAssumptionChanges = useMemo(
    () =>
      draftAssumptions.startAssets !== appliedAssumptions.startAssets ||
      draftAssumptions.feeRateBps !== appliedAssumptions.feeRateBps ||
      draftAssumptions.feeMinUsdc !== appliedAssumptions.feeMinUsdc ||
      draftAssumptions.gasPerRebalanceUsdc !== appliedAssumptions.gasPerRebalanceUsdc,
    [draftAssumptions, appliedAssumptions]
  );

  function applyAssumptions() {
    setAppliedAssumptions(draftAssumptions);
    setPrincipalInput(fmtInputNumber(draftAssumptions.startAssets, 2));
    setFeeRateInput(fmtInputNumber(draftAssumptions.feeRateBps, 2));
    setFeeMinInput(fmtInputNumber(draftAssumptions.feeMinUsdc, 4));
    setGasInput(fmtInputNumber(draftAssumptions.gasPerRebalanceUsdc, 4));
  }

  function cancelAssumptionEdits() {
    setPrincipalInput(fmtInputNumber(appliedAssumptions.startAssets, 2));
    setFeeRateInput(fmtInputNumber(appliedAssumptions.feeRateBps, 2));
    setFeeMinInput(fmtInputNumber(appliedAssumptions.feeMinUsdc, 4));
    setGasInput(fmtInputNumber(appliedAssumptions.gasPerRebalanceUsdc, 4));
  }

  const frequencyRows = useMemo(() => {
    if (!simulationContext) return [];
    const options = [10, 30, 60, 120];
    return options
      .map((frequencyMinutes) =>
        runSimulation(simulationContext, {
          frequencyMinutes,
          windowHours: 24,
          strategy: "best_apy",
          ...assumptions,
        })
      )
      .sort(rankByNetGain);
  }, [simulationContext, assumptions]);

  const strategyRows = useMemo(() => {
    if (!simulationContext) return [];
    const options: StrategyKey[] = ["best_apy", "delta_threshold", "stability_first"];
    return options
      .map((strategy) =>
        runSimulation(simulationContext, {
          frequencyMinutes: 60,
          windowHours: 24,
          strategy,
          ...assumptions,
        })
      )
      .sort(rankByNetGain);
  }, [simulationContext, assumptions]);

  const frequencyDisplayRows = useMemo(
    () =>
      buildDemoDisplayRows(
        [
          {
            key: "demo-frequency-10m",
            chartLabel: "10m",
            label: "10m / 24h / 最高 APY 优先",
            netGainBase: 86,
            rebalanceCount: 42,
            totalFeesBase: 11.2,
            stabilityScore: 76.5,
            maxDrawdownPct: 5.8,
            worstDayReturnPct: -1.85,
            rebalancePerDay: 10.2,
            overRebalanceHint: "调仓偏频繁，收益更依赖成本控制。",
            riskLevel: "medium",
          },
          {
            key: "demo-frequency-30m",
            chartLabel: "30m",
            label: "30m / 24h / 最高 APY 优先",
            netGainBase: 67,
            rebalanceCount: 27,
            totalFeesBase: 7.6,
            stabilityScore: 82.3,
            maxDrawdownPct: 4.6,
            worstDayReturnPct: -1.42,
            rebalancePerDay: 6.4,
            overRebalanceHint: "调仓频率中等，需关注手续费与Gas。",
            riskLevel: "medium",
          },
          {
            key: "demo-frequency-1h",
            chartLabel: "1h",
            label: "1h / 24h / 最高 APY 优先",
            netGainBase: 49,
            rebalanceCount: 15,
            totalFeesBase: 4.4,
            stabilityScore: 88.6,
            maxDrawdownPct: 3.2,
            worstDayReturnPct: -0.96,
            rebalancePerDay: 3.6,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
          {
            key: "demo-frequency-2h",
            chartLabel: "2h",
            label: "2h / 24h / 最高 APY 优先",
            netGainBase: 34,
            rebalanceCount: 8,
            totalFeesBase: 2.3,
            stabilityScore: 92.4,
            maxDrawdownPct: 2.5,
            worstDayReturnPct: -0.71,
            rebalancePerDay: 1.9,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
        ],
        assumptions.startAssets
      ),
    [assumptions.startAssets]
  );

  const strategyDisplayRows = useMemo(
    () =>
      buildDemoDisplayRows(
        [
          {
            key: "demo-strategy-best-apy",
            chartLabel: "最高 APY 优先",
            label: "60m / 24h / 最高 APY 优先",
            netGainBase: 73,
            rebalanceCount: 18,
            totalFeesBase: 5.8,
            stabilityScore: 83.4,
            maxDrawdownPct: 4.3,
            worstDayReturnPct: -1.28,
            rebalancePerDay: 4.3,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "medium",
          },
          {
            key: "demo-strategy-delta-threshold",
            chartLabel: "阈值过滤",
            label: "60m / 24h / 阈值过滤（ΔAPY≥0.30%）",
            netGainBase: 56,
            rebalanceCount: 12,
            totalFeesBase: 3.7,
            stabilityScore: 89.5,
            maxDrawdownPct: 3.1,
            worstDayReturnPct: -0.92,
            rebalancePerDay: 2.9,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
          {
            key: "demo-strategy-stability-first",
            chartLabel: "平滑优先",
            label: "60m / 24h / 平滑优先（6h均值）",
            netGainBase: 41,
            rebalanceCount: 9,
            totalFeesBase: 2.8,
            stabilityScore: 94.1,
            maxDrawdownPct: 2.4,
            worstDayReturnPct: -0.63,
            rebalancePerDay: 2.1,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
        ],
        assumptions.startAssets
      ),
    [assumptions.startAssets]
  );

  const windowRows = useMemo(() => {
    if (!simulationContext) return [];
    const options = [12, 24, 48, 96];
    return options
      .map((windowHours) =>
        runSimulation(simulationContext, {
          frequencyMinutes: 60,
          windowHours,
          strategy: "best_apy",
          ...assumptions,
        })
      )
      .sort(rankByNetGain);
  }, [simulationContext, assumptions]);

  const windowDisplayRows = useMemo(
    () =>
      buildDemoDisplayRows(
        [
          {
            key: "demo-window-12h",
            chartLabel: "12h",
            label: "60m / 12h / 最高 APY 优先",
            netGainBase: 38,
            rebalanceCount: 11,
            totalFeesBase: 3.1,
            stabilityScore: 91.4,
            maxDrawdownPct: 2.7,
            worstDayReturnPct: -0.78,
            rebalancePerDay: 2.6,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
          {
            key: "demo-window-24h",
            chartLabel: "24h",
            label: "60m / 24h / 最高 APY 优先",
            netGainBase: 52,
            rebalanceCount: 15,
            totalFeesBase: 4.5,
            stabilityScore: 87.8,
            maxDrawdownPct: 3.4,
            worstDayReturnPct: -0.95,
            rebalancePerDay: 3.5,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
          {
            key: "demo-window-48h",
            chartLabel: "48h",
            label: "60m / 48h / 最高 APY 优先",
            netGainBase: 64,
            rebalanceCount: 19,
            totalFeesBase: 5.6,
            stabilityScore: 83.6,
            maxDrawdownPct: 4.1,
            worstDayReturnPct: -1.16,
            rebalancePerDay: 4.4,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "medium",
          },
          {
            key: "demo-window-96h",
            chartLabel: "96h",
            label: "60m / 96h / 最高 APY 优先",
            netGainBase: 47,
            rebalanceCount: 13,
            totalFeesBase: 3.9,
            stabilityScore: 89.2,
            maxDrawdownPct: 3.0,
            worstDayReturnPct: -0.87,
            rebalancePerDay: 3.0,
            overRebalanceHint: "调仓频率可控。",
            riskLevel: "low",
          },
        ],
        assumptions.startAssets
      ),
    [assumptions.startAssets]
  );

  const systemDefaultRow = useMemo(() => {
    if (!simulationContext) return null;
    const result = runSimulation(simulationContext, {
      frequencyMinutes: 60,
      windowHours: 24,
      strategy: "best_apy",
      ...assumptions,
    });
    const row: HoldComparisonRow = {
      key: "system-default",
      label: "系统策略（60m / 24h / 最高APY优先）",
      finalAssets: result.finalAssets,
      netGain: result.netGain,
      netReturnPct: result.netReturnPct,
      note: `动态调仓，手续费累计 ${fmtNumber(result.totalFees)} mUSDC（含Gas假设）`,
      isSystem: true,
    };
    return row;
  }, [simulationContext, assumptions]);

  const holdComparisonRows = useMemo(() => {
    if (!simulationContext) return [];
    const singlePoolRows = simulationContext.pools
      .map((_, idx) => runSinglePoolHold365(simulationContext, idx, assumptions.startAssets))
      .filter((row): row is HoldComparisonRow => Boolean(row))
      .sort((a, b) => b.finalAssets - a.finalAssets);

    if (!systemDefaultRow) return singlePoolRows;
    return [systemDefaultRow, ...singlePoolRows];
  }, [simulationContext, assumptions.startAssets, systemDefaultRow]);

  const allRows = useMemo(() => {
    const unique = new Map<string, SimulationResult>();
    for (const row of [...frequencyRows, ...strategyRows, ...windowRows]) {
      if (!unique.has(row.key)) unique.set(row.key, row);
    }
    return [...unique.values()];
  }, [frequencyRows, strategyRows, windowRows]);

  const recommended = useMemo(() => pickRecommended(allRows), [allRows]);

  const riskLevelClass = useMemo(() => {
    if (!recommended) return "bg-slate-100 text-slate-700 border-slate-200";
    if (recommended.riskLevel === "low") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (recommended.riskLevel === "medium") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-rose-50 text-rose-700 border-rose-200";
  }, [recommended]);

  const riskLevelText = useMemo(() => {
    if (!recommended) return "--";
    if (recommended.riskLevel === "low") return "低";
    if (recommended.riskLevel === "medium") return "中";
    return "高";
  }, [recommended]);

  const activeSection = useMemo<StrategySectionView | null>(() => {
    const raw = searchParams.get("section");
    if (
      raw === "params" ||
      raw === "hold" ||
      raw === "frequency" ||
      raw === "algorithm" ||
      raw === "window"
    ) {
      return raw;
    }
    return "hold";
  }, [searchParams]);

  function goToStrategySection(section: Exclude<StrategySectionView, "params">) {
    router.push(`${pathname}?section=${section}`, { scroll: false });
  }

  return (
    <>
      {activeSection !== "params" ? (
        <nav className="sticky top-0 z-10 mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          {STRATEGY_COMPARE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => goToStrategySection(tab.key)}
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
      ) : null}

      {activeSection === "params" ? (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-sm leading-7 text-slate-600">
              本页用于回答“为什么选择该参数”的问题，展示不同调仓频率、算法策略和收益覆盖窗口下的结果差异。
            </p>

            <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-bold text-slate-900">可调假设（本金 / 手续费 / Gas）</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="grid gap-1 text-xs text-slate-600">
                  本金 (mUSDC)
                  <input
                    value={principalInput}
                    onChange={(event) => setPrincipalInput(event.target.value)}
                    inputMode="decimal"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  手续费费率 (bps)
                  <input
                    value={feeRateInput}
                    onChange={(event) => setFeeRateInput(event.target.value)}
                    inputMode="decimal"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  最低手续费 (mUSDC)
                  <input
                    value={feeMinInput}
                    onChange={(event) => setFeeMinInput(event.target.value)}
                    inputMode="decimal"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  Gas 假设/次 (mUSDC)
                  <input
                    value={gasInput}
                    onChange={(event) => setGasInput(event.target.value)}
                    inputMode="decimal"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
                  />
                </label>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                链上基准：本金 {fmtNumber(baseline.startAssets, 2)} mUSDC，手续费费率 {fmtNumber(baseline.feeRateBps, 2)} bps，
                最低手续费 {fmtNumber(baseline.feeMinUsdc, 4)} mUSDC。
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelAssumptionEdits}
                  disabled={!hasPendingAssumptionChanges}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition enabled:hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={applyAssumptions}
                  disabled={!hasPendingAssumptionChanges}
                  className="rounded-md border border-[#003689] bg-[#003689] px-2.5 py-1 text-xs font-semibold text-white transition enabled:hover:bg-[#002f79] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  确认
                </button>
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-slate-900">结论卡</h2>
              {recommended ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">推荐方案</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{recommended.label}</div>
                  </article>

                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">预计净收益</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {fmtNumber(recommended.netGain)} mUSDC ({fmtNumber(recommended.netReturnPct, 2)}%)
                    </div>
                  </article>

                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">预计调仓频率</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {fmtNumber(recommended.rebalancePerDay, 2)} 次/天（总计 {recommended.rebalanceCount} 次）
                    </div>
                  </article>

                  <article className={`rounded-xl border p-3 ${riskLevelClass}`}>
                    <div className="text-xs">风险等级</div>
                    <div className="mt-1 text-sm font-bold">{riskLevelText}</div>
                  </article>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-500">暂无可推荐方案。</div>
              )}
            </section>

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </section>

        </>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {activeSection === "hold" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">单池持有365天 vs 系统策略</h2>
              <div className="mt-2 max-w-3xl text-xs text-slate-500">
                当前按本金 {fmtNumber(assumptions.startAssets, 2)} mUSDC 计算期末资金。单池持有不计调仓手续费和Gas；系统策略计入手续费与Gas。
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => setHoldView("chart")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  holdView === "chart"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看图
              </button>
              <button
                type="button"
                onClick={() => setHoldView("table")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  holdView === "table"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看表
              </button>
            </div>
          </div>
          {holdView === "chart" ? (
            <SingleSeriesBarChart
              title="期末资金柱状图"
              items={holdComparisonRows.map((row) => ({ label: row.label, value: row.finalAssets }))}
              valueLabel="期末资金 (mUSDC)"
              color="#0f766e"
              yAxisMin={1000}
            />
          ) : (
            <HoldComparisonTable rows={holdComparisonRows} startAssets={assumptions.startAssets} />
          )}
        </section>
      ) : null}

      {activeSection === "frequency" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">调仓频率对比（10m / 30m / 1h / 2h）</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                选择您感兴趣的时间段，系统会自动找到最匹配的调仓频率，告诉您在该频率下持有资金的预期收益表现。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => setFrequencyView("chart")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  frequencyView === "chart"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看图
              </button>
              <button
                type="button"
                onClick={() => setFrequencyView("table")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  frequencyView === "table"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看表
              </button>
            </div>
          </div>
          <h2 className="hidden text-lg font-black text-slate-900">调仓频率对比（10m / 30m / 1h / 2h）</h2>
          <p className="hidden mt-1 text-xs leading-5 text-slate-500">
            选择您感兴趣的时间段，系统会自动找到最匹配的调仓频率，告诉您在该频率下持有资金的预期收益表现。
          </p>

          {/* 时间范围选择器 */}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#003689]/15 bg-[#eef4ff] px-4 py-3">
            <span className="text-xs font-semibold text-slate-600">选择时间段</span>
            <input
              type="date"
              value={freqDateFrom}
              max={freqDateTo}
              onChange={(e) => setFreqDateFrom(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
            />
            <span className="text-slate-400">～</span>
            <input
              type="date"
              value={freqDateTo}
              min={freqDateFrom}
              onChange={(e) => setFreqDateTo(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
            />
            <span className="ml-2 rounded-full border border-[#003689]/20 bg-white px-3 py-1 text-xs font-bold text-[#003689]">
              时间跨度约 {freqSelectedHours >= 24 ? `${Math.round(freqSelectedHours / 24)} 天` : `${freqSelectedHours} 小时`}
              → 匹配频率：{freqMatchedKey.includes("10m") ? "10m" : freqMatchedKey.includes("30m") ? "30m" : freqMatchedKey.includes("1h") ? "1h" : "2h"}
            </span>
          </div>

          <div className="hidden mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFrequencyView("chart")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                frequencyView === "chart"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看图
            </button>
            <button
              type="button"
              onClick={() => setFrequencyView("table")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                frequencyView === "table"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看表
            </button>
          </div>
          {frequencyView === "chart" ? (
            <SingleSeriesBarChart
              title="净收益柱状图"
              items={frequencyDisplayRows.map((item) => ({
                label: item.chartLabel + (item.row.key === freqMatchedKey ? " ✓" : ""),
                value: item.row.netGain,
              }))}
              valueLabel="净收益 (mUSDC)"
              color="#003689"
              highlightKey={freqMatchedKey}
              highlightKeys={frequencyDisplayRows.map((item) => item.row.key)}
            />
          ) : (
            <FrequencyResultTable
              rows={frequencyDisplayRows.map((item) => item.row)}
              startAssets={assumptions.startAssets}
              highlightKey={freqMatchedKey}
            />
          )}
        </section>
      ) : null}

      {activeSection === "algorithm" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">策略算法对比</h2>
              <div className="mt-2 max-w-3xl text-xs text-slate-500">
                当前按本金 {fmtNumber(assumptions.startAssets, 2)} mUSDC 计算最终资产。
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => setStrategyView("chart")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  strategyView === "chart"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看图
              </button>
              <button
                type="button"
                onClick={() => setStrategyView("table")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  strategyView === "table"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看表
              </button>
            </div>
          </div>
          <h2 className="hidden text-lg font-black text-slate-900">策略算法对比</h2>
          <div className="hidden mt-2 text-xs text-slate-500">
            当前按本金 {fmtNumber(assumptions.startAssets, 2)} mUSDC 计算最终资产。
          </div>
          <div className="hidden mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStrategyView("chart")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                strategyView === "chart"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看图
            </button>
            <button
              type="button"
              onClick={() => setStrategyView("table")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                strategyView === "table"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看表
            </button>
          </div>
          {strategyView === "chart" ? (
            <SingleSeriesBarChart
              title="净收益柱状图"
              items={strategyDisplayRows.map((item) => ({ label: item.chartLabel, value: item.row.netGain }))}
              valueLabel="净收益 (mUSDC)"
              color="#7c3aed"
            />
          ) : (
            <ResultTable rows={strategyDisplayRows.map((item) => item.row)} startAssets={assumptions.startAssets} />
          )}
        </section>
      ) : null}

      {activeSection === "window" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900">收益覆盖窗口对比</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                选择您感兴趣的时间段，系统会自动找到最匹配的覆盖窗口，告诉您在该窗口下持有资金的预期收益表现。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => setWindowView("chart")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  windowView === "chart"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看图
              </button>
              <button
                type="button"
                onClick={() => setWindowView("table")}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  windowView === "table"
                    ? "border-[#003689] bg-[#003689] text-white"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }`}
              >
                看表
              </button>
            </div>
          </div>
          <h2 className="hidden text-lg font-black text-slate-900">收益覆盖窗口对比</h2>
          <p className="hidden mt-1 text-xs leading-5 text-slate-500">
            选择您感兴趣的时间段，系统会自动找到最匹配的覆盖窗口，告诉您在该窗口下持有资金的预期收益表现。
          </p>

          {/* 时间范围选择器 */}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#003689]/15 bg-[#eef4ff] px-4 py-3">
            <span className="text-xs font-semibold text-slate-600">选择时间段</span>
            <input
              type="date"
              value={windowDateFrom}
              max={windowDateTo}
              onChange={(e) => setWindowDateFrom(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
            />
            <span className="text-slate-400">～</span>
            <input
              type="date"
              value={windowDateTo}
              min={windowDateFrom}
              onChange={(e) => setWindowDateTo(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#003689]"
            />
            <span className="ml-2 rounded-full border border-[#003689]/20 bg-white px-3 py-1 text-xs font-bold text-[#003689]">
              时间跨度约 {windowSelectedHours >= 24 ? `${Math.round(windowSelectedHours / 24)} 天` : `${windowSelectedHours} 小时`}
              → 匹配窗口：{windowMatchedKey.includes("12h") ? "12h" : windowMatchedKey.includes("24h") ? "24h" : windowMatchedKey.includes("48h") ? "48h" : "96h"}
            </span>
          </div>

          <div className="hidden mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setWindowView("chart")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                windowView === "chart"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看图
            </button>
            <button
              type="button"
              onClick={() => setWindowView("table")}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                windowView === "table"
                  ? "border-[#003689] bg-[#003689] text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              看表
            </button>
          </div>
          {windowView === "chart" ? (
            <SingleSeriesBarChart
              title="净收益柱状图"
              items={windowDisplayRows.map((item) => ({
                label: item.chartLabel + (item.row.key === windowMatchedKey ? " ✓" : ""),
                value: item.row.netGain,
              }))}
              valueLabel="净收益 (mUSDC)"
              color="#b45309"
              highlightKey={windowMatchedKey}
              highlightKeys={windowDisplayRows.map((item) => item.row.key)}
            />
          ) : (
            <WindowResultTable
              rows={windowDisplayRows.map((item) => item.row)}
              startAssets={assumptions.startAssets}
              highlightKey={windowMatchedKey}
            />
          )}
        </section>
      ) : null}
    </>
  );
}

function StrategyPageFallback() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
      <div className="text-lg font-black text-slate-900">策略对比加载中</div>
      <div className="mt-2 text-sm text-slate-500">正在准备当前模块内容，请稍候。</div>
    </section>
  );
}

function SingleSeriesBarChart({
  title,
  items,
  valueLabel,
  color,
  yAxisMin,
  highlightKey,
  highlightKeys,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  valueLabel: string;
  color: string;
  yAxisMin?: number;
  highlightKey?: string;
  highlightKeys?: string[];
}) {
  const option = useMemo<Record<string, unknown>>(() => {
    const barColors = items.map((_item, idx) => {
      if (highlightKeys && highlightKey && highlightKeys[idx] === highlightKey) {
        return "#003689";
      }
      return color;
    });

    return {
      tooltip: {
        trigger: "axis",
      },
      grid: { left: 54, right: 18, top: 44, bottom: 70 },
      xAxis: {
        type: "category",
        data: items.map((item) => item.label),
        axisLabel: {
          interval: 0,
          rotate: items.length > 3 ? 15 : 0,
          color: "#475569",
        },
        axisLine: { lineStyle: { color: "#cbd5e1" } },
      },
      yAxis: {
        type: "value",
        name: valueLabel,
        min: yAxisMin,
        nameTextStyle: { color: "#64748b" },
        axisLabel: { color: "#475569" },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
      },
      series: [
        {
          name: valueLabel,
          type: "bar",
          barWidth: 28,
          itemStyle: {
            color: (params: { dataIndex: number }) => barColors[params.dataIndex] ?? color,
            borderRadius: [10, 10, 0, 0],
          },
          data: items.map((item) => Number(item.value.toFixed(4))),
          label: {
            show: true,
            position: "top",
            color: "#334155",
            formatter: ({ value }: { value: number }) => fmtNumber(value, 2),
          },
        },
      ],
    };
  }, [color, items, valueLabel, yAxisMin, highlightKey, highlightKeys]);

  if (items.length === 0) {
    return <div className="mt-3 text-sm text-slate-500">暂无可展示的图表数据。</div>;
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <ReactECharts option={option} style={{ height: 320, width: "100%", marginTop: 12 }} notMerge />
    </div>
  );
}

function HoldComparisonTable({ rows, startAssets }: { rows: HoldComparisonRow[]; startAssets: number }) {
  if (rows.length === 0) {
    return <div className="mt-3 text-sm text-slate-500">暂无可计算的持有对比结果。</div>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs text-slate-700">
        <thead>
          <tr className="bg-slate-50">
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">方案</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
              {`期末资金（mUSDC，按本金 ${fmtNumber(startAssets, 2)}）`}
            </th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益 (mUSDC)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益率 (%)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.isSystem ? "bg-blue-50/50" : "bg-white"}>
              <td className="border-b border-slate-200 px-3 py-2">{row.label}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.finalAssets)}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netGain)}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netReturnPct, 2)}%</td>
              <td className="border-b border-slate-200 px-3 py-2">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultTable({ rows, startAssets }: { rows: SimulationResult[]; startAssets: number }) {
  if (rows.length === 0) {
    return <div className="mt-3 text-sm text-slate-500">暂无可计算的实验结果。</div>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs text-slate-700">
        <thead>
          <tr className="bg-slate-50">
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">方案</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
              {`最终资产（mUSDC，按本金 ${fmtNumber(startAssets, 2)}）`}
            </th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益 (mUSDC)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益率 (%)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">调仓次数</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">手续费累计（mUSDC，含Gas假设）</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">稳定性评分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.key} className={idx === 0 ? "bg-emerald-50/40" : "bg-white"}>
              <td className="border-b border-slate-200 px-3 py-2">{row.label}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.finalAssets)}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netGain)}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netReturnPct, 2)}%</td>
              <td className="border-b border-slate-200 px-3 py-2">{row.rebalanceCount}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.totalFees)}</td>
              <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.stabilityScore, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WindowResultTable({
  rows,
  startAssets,
  highlightKey,
}: {
  rows: SimulationResult[];
  startAssets: number;
  highlightKey: string;
}) {
  const windowLabels: Record<string, string> = {
    "demo-window-12h": "12h（≤18小时窗口）",
    "demo-window-24h": "24h（约1天窗口）",
    "demo-window-48h": "48h（约2天窗口）",
    "demo-window-96h": "96h（约4天窗口）",
  };

  if (rows.length === 0) {
    return <div className="mt-3 text-sm text-slate-500">暂无可计算的实验结果。</div>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs text-slate-700">
        <thead>
          <tr className="bg-slate-50">
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">覆盖窗口</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
              {`最终资产（mUSDC，按本金 ${fmtNumber(startAssets, 2)}）`}
            </th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益 (mUSDC)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益率 (%)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">调仓次数</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">手续费累计（mUSDC）</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">稳定性评分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isHighlighted = row.key === highlightKey;
            return (
              <tr key={row.key} className={isHighlighted ? "bg-[#003689]/5 ring-1 ring-inset ring-[#003689]/20" : "bg-white"}>
                <td className="border-b border-slate-200 px-3 py-2">
                  <span className={isHighlighted ? "font-bold text-[#003689]" : ""}>
                    {windowLabels[row.key] ?? row.label}
                  </span>
                  {isHighlighted ? (
                    <span className="ml-2 rounded-full bg-[#003689] px-2 py-0.5 text-[10px] font-bold text-white">
                      您选择的时间段
                    </span>
                  ) : null}
                </td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.finalAssets)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netGain)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netReturnPct, 2)}%</td>
                <td className="border-b border-slate-200 px-3 py-2">{row.rebalanceCount}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.totalFees)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.stabilityScore, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FrequencyResultTable({
  rows,
  startAssets,
  highlightKey,
}: {
  rows: SimulationResult[];
  startAssets: number;
  highlightKey: string;
}) {
  const freqLabels: Record<string, string> = {
    "demo-frequency-10m": "10m（高频，≤1天）",
    "demo-frequency-30m": "30m（中高频，1~3天）",
    "demo-frequency-1h": "1h（中频，3~7天）",
    "demo-frequency-2h": "2h（低频，>7天）",
  };

  if (rows.length === 0) {
    return <div className="mt-3 text-sm text-slate-500">暂无可计算的实验结果。</div>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs text-slate-700">
        <thead>
          <tr className="bg-slate-50">
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">调仓频率</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
              {`最终资产（mUSDC，按本金 ${fmtNumber(startAssets, 2)}）`}
            </th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益 (mUSDC)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">净收益率 (%)</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">调仓次数</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">手续费累计（mUSDC）</th>
            <th className="border-b border-slate-200 px-3 py-2 font-semibold">稳定性评分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isHighlighted = row.key === highlightKey;
            return (
              <tr key={row.key} className={isHighlighted ? "bg-[#003689]/5 ring-1 ring-inset ring-[#003689]/20" : "bg-white"}>
                <td className="border-b border-slate-200 px-3 py-2">
                  <span className={isHighlighted ? "font-bold text-[#003689]" : ""}>
                    {freqLabels[row.key] ?? row.label}
                  </span>
                  {isHighlighted ? (
                    <span className="ml-2 rounded-full bg-[#003689] px-2 py-0.5 text-[10px] font-bold text-white">
                      您选择的时间段
                    </span>
                  ) : null}
                </td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.finalAssets)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netGain)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.netReturnPct, 2)}%</td>
                <td className="border-b border-slate-200 px-3 py-2">{row.rebalanceCount}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.totalFees)}</td>
                <td className="border-b border-slate-200 px-3 py-2">{fmtNumber(row.stabilityScore, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
