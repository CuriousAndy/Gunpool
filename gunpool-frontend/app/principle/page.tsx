"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import { ConsoleLayout } from "@/src/components/layout/console-layout";

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

// ===== 仿真数据生成 =====
const NOW = Date.now();
const HOUR = 3_600_000;

function sr(seed: number, offset: number): number {
  const x = Math.sin(seed * 9301 + offset * 49297 + 233) * 93647.3;
  return x - Math.floor(x);
}

type PoolMeta = { id: string; name: string; apy: number; color: string };

const POOL_A: PoolMeta = { id: "aave-v3", name: "Aave V3 USDC", apy: 4.85, color: "#6366f1" };
const TARGET_POOLS: PoolMeta[] = [
  { id: "venus-usdc", name: "Venus USDC", apy: 6.12, color: "#f59e0b" },
  { id: "morpho-usdc", name: "Morpho USDC", apy: 6.09, color: "#0f766e" },
  { id: "spark-usdc", name: "Spark USDC", apy: 5.91, color: "#06b6d4" },
  { id: "compound-v3-usdc", name: "Compound V3 USDC", apy: 5.88, color: "#22c55e" },
  { id: "radiant-usdc", name: "Radiant USDC", apy: 5.73, color: "#8b5cf6" },
  { id: "aave-v3-usdc", name: "Aave V3 USDC", apy: 5.61, color: "#6366f1" },
];
const CURRENT_ASSETS = 1283.47;
const BASE_GAS_COST = 0.0124;
const VARIABLE_FEE_RATE = 0.0000145;
const WINDOW_HOURS = 24;
const BEST_TARGET_POOL = TARGET_POOLS.reduce((best, pool) => (pool.apy > best.apy ? pool : best), TARGET_POOLS[0]!);

function calculateExpectedGain(targetApy: number, amount = CURRENT_ASSETS): number {
  if (amount <= 0) return 0;
  const delta = targetApy - POOL_A.apy;
  return Number((((delta / 100 / 365 / 24) * WINDOW_HOURS * amount)).toFixed(4));
}

function calculateMoveFee(amount: number): number {
  if (amount <= 0) return 0;
  return Number((BASE_GAS_COST + amount * VARIABLE_FEE_RATE).toFixed(4));
}

function formatPercentValue(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

// 收益覆盖窗口内的预期增益
const deltaApy = BEST_TARGET_POOL.apy - POOL_A.apy;
const expectedGain = calculateExpectedGain(BEST_TARGET_POOL.apy, CURRENT_ASSETS);
const FEE = calculateMoveFee(CURRENT_ASSETS);
const shouldRebalance = expectedGain > FEE;

// 过去72小时的APY数据
const hoursBack = 72;
const apyHistory = Array.from({ length: hoursBack + 1 }, (_, i) => {
  const t = NOW - (hoursBack - i) * HOUR;
  const apyA = 4.8 + Math.sin(i / 8) * 0.5 + (sr(i, 0) - 0.5) * 0.3;
  const apyB = 5.9 + Math.sin(i / 6 + 1) * 0.6 + (sr(i, 1) - 0.5) * 0.4;
  return { t, apyA: Number(apyA.toFixed(3)), apyB: Number(apyB.toFixed(3)) };
});

// "如果8小时前没有调仓" 对比曲线
const pastHours = 48;
const comparisonHistory = Array.from({ length: pastHours + 1 }, (_, i) => {
  const t = NOW - (pastHours - i) * HOUR;
  const factor = i / pastHours;
  // 实际路径（已调仓）: 在第16小时切换到高APY池
  const switched = i >= 16;
  const actualApy = switched ? BEST_TARGET_POOL.apy : POOL_A.apy;
  const noRebalanceApy = POOL_A.apy;
  const actualAssets = Number((1000 * Math.exp((actualApy / 100 / 365 / 24) * i)).toFixed(4));
  const holdAssets = Number((1000 * Math.exp((noRebalanceApy / 100 / 365 / 24) * i)).toFixed(4));
  void factor;
  return { t, actual: actualAssets, hold: holdAssets };
});

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type SectionKey = "data" | "anim" | "apy" | "comp" | "log";
export default function PrinciplePage() {
  const [activeSection, setActiveSection] = useState<SectionKey>("data");
  const [animating, setAnimating] = useState(false);
  const [animStep, setAnimStep] = useState<"idle" | "checking" | "moving" | "done">("idle");
  const [rebalanced, setRebalanced] = useState(false);
  const [tick, setTick] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState(BEST_TARGET_POOL.id);
  const [movePercentInput, setMovePercentInput] = useState("100");
  const [movePercentFocused, setMovePercentFocused] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [lossWarningOpen, setLossWarningOpen] = useState(false);

  // 自动更新当前时间（让时间戳看起来实时）
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const selectedTargetPool = useMemo(
    () => TARGET_POOLS.find((pool) => pool.id === selectedTargetId) ?? BEST_TARGET_POOL,
    [selectedTargetId]
  );
  const customMovePercent = useMemo(() => {
    const parsed = Number(movePercentInput);
    if (Number.isNaN(parsed)) return 0;
    return Math.min(100, Math.max(0, parsed));
  }, [movePercentInput]);
  const movePercent = customMovePercent;
  const moveAmount = useMemo(() => Number(((CURRENT_ASSETS * movePercent) / 100).toFixed(2)), [movePercent]);
  const selectedFee = useMemo(() => calculateMoveFee(moveAmount), [moveAmount]);
  const selectedDeltaApy = useMemo(() => selectedTargetPool.apy - POOL_A.apy, [selectedTargetPool]);
  const selectedExpectedGain = useMemo(
    () => calculateExpectedGain(selectedTargetPool.apy, moveAmount),
    [selectedTargetPool, moveAmount]
  );
  const selectedNetGain = useMemo(() => Number((selectedExpectedGain - selectedFee).toFixed(4)), [selectedExpectedGain, selectedFee]);
  const selectedCanCoverFee = moveAmount > 0 && selectedNetGain >= 0;
  const currentPoolAfterAmount = Math.max(Number((CURRENT_ASSETS - moveAmount).toFixed(2)), 0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the commented migration preview block
  const targetPoolAfterAmount = Math.max(Number((moveAmount - selectedFee).toFixed(2)), 0);
  const movePercentDisplayMuted = !movePercentFocused && movePercentInput === "100";
  const movePercentLabel = `${formatPercentValue(movePercent)}% 资金`;
  const canExecuteRebalance = moveAmount > 0;
  const previewConclusion =
    moveAmount <= 0 ? "请输入迁移比例" : selectedCanCoverFee ? "增益可以覆盖手续费" : "增益无法覆盖手续费";
  const previewToneClass = selectedCanCoverFee ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50";
  const previewBadgeClass = selectedCanCoverFee ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
  const modalBackdropOpen = previewDialogOpen || lossWarningOpen;

  useEffect(() => {
    if (!modalBackdropOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [modalBackdropOpen]);

  function resetMigrationPreview() {
    if (animating) return;
    setAnimStep("idle");
    setRebalanced(false);
    setPreviewDialogOpen(false);
    setLossWarningOpen(false);
  }

  async function handleRebalance() {
    if (animating) return;
    setPreviewDialogOpen(false);
    setLossWarningOpen(false);
    setAnimating(true);
    setAnimStep("checking");
    await new Promise<void>((r) => window.setTimeout(r, 1200));
    setAnimStep("moving");
    await new Promise<void>((r) => window.setTimeout(r, 1800));
    setAnimStep("done");
    setRebalanced(true);
    await new Promise<void>((r) => window.setTimeout(r, 500));
    setAnimating(false);
  }

  function openPreviewDialog() {
    if (animating || rebalanced || !canExecuteRebalance) return;
    setLossWarningOpen(false);
    setPreviewDialogOpen(true);
  }

  function handlePreviewConfirm() {
    if (!canExecuteRebalance || animating) return;
    if (selectedCanCoverFee) {
      void handleRebalance();
      return;
    }
    setPreviewDialogOpen(false);
    setLossWarningOpen(true);
  }

  function handleLossConfirm() {
    if (!canExecuteRebalance || animating) return;
    void handleRebalance();
  }

  const apyChartOption = useMemo<Record<string, unknown>>(() => ({
    legend: { top: 8, textStyle: { color: "#334155" } },
    grid: { left: 54, right: 18, top: 48, bottom: 60 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ axisValue?: number; value?: [number, number]; marker: string; seriesName: string }>;
        const t = Number(rows[0]?.value?.[0] ?? rows[0]?.axisValue ?? 0);
        return [fmtTime(t), ...rows.map(r => `${r.marker}${r.seriesName}: ${Number(r.value?.[1] ?? 0).toFixed(2)}%`)].join("<br/>");
      },
    },
    xAxis: { type: "time", axisLabel: { color: "#64748b", fontSize: 11 } },
    yAxis: {
      type: "value",
      name: "APY (%)",
      axisLabel: { color: "#64748b", formatter: (v: number) => `${v.toFixed(1)}%` },
      nameTextStyle: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
    },
    series: [
      {
        name: POOL_A.name,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: POOL_A.color, width: 2.2 },
        data: apyHistory.map(p => [p.t, p.apyA]),
      },
      {
        name: BEST_TARGET_POOL.name,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: BEST_TARGET_POOL.color, width: 2.2 },
        data: apyHistory.map(p => [p.t, p.apyB]),
      },
    ],
  }), []);

  const compChartOption = useMemo<Record<string, unknown>>(() => ({
    legend: { top: 8, textStyle: { color: "#334155" } },
    grid: { left: 60, right: 18, top: 48, bottom: 60 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{ value?: [number, number]; marker: string; seriesName: string }>;
        const t = Number(rows[0]?.value?.[0] ?? 0);
        return [fmtTime(t), ...rows.map(r => `${r.marker}${r.seriesName}: ${Number(r.value?.[1] ?? 0).toFixed(4)} mUSDC`)].join("<br/>");
      },
    },
    xAxis: { type: "time", axisLabel: { color: "#64748b", fontSize: 11 } },
    yAxis: {
      type: "value",
      name: "资金 (mUSDC)",
      scale: true,
      axisLabel: { color: "#64748b", formatter: (v: number) => v.toFixed(2) },
      nameTextStyle: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
    },
    series: [
      {
        name: "已调仓（实际路径）",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#10b981", width: 2.5 },
        areaStyle: { color: "rgba(16,185,129,0.08)" },
        data: comparisonHistory.map(p => [p.t, p.actual]),
      },
      {
        name: "未调仓（假设路径）",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#ef4444", width: 2, type: "dashed" },
        data: comparisonHistory.map(p => [p.t, p.hold]),
      },
    ],
    markLine: {
      data: [{ xAxis: NOW - 32 * HOUR, lineStyle: { color: "#f59e0b", type: "solid" }, label: { formatter: "调仓时刻" } }],
    },
  }), []);

  const NAV_TABS: { key: SectionKey; label: string }[] = [
    { key: "data", label: "当前关键数据" },
    { key: "anim", label: "资金迁移演示" },
    { key: "apy", label: "APY 走势" },
    { key: "comp", label: "收益对比" },
    { key: "log", label: "决策记录" },
  ];

  return (
    <ConsoleLayout title="调仓决策" hidePageHeader>
      <div className="grid gap-5">

        {/* 二级 Tab 导航 */}
        <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSection(tab.key)}
              className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeSection === tab.key
                ? "bg-[#003689] text-white shadow-sm"
                : "text-slate-600 hover:bg-[#003689]/10 hover:text-[#003689]"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 核心判断数据 */}
        {activeSection === "data" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">1</div>
              <h2 className="text-lg font-black text-slate-900">当前关键数据</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '16px', marginTop: '16px' }}>
              {/* 左：4个指标 + 3个数据框 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
                  {[
                    { label: "当前资金池", value: POOL_A.name, sub: "正在使用" },
                    { label: "当前 APY", value: `${POOL_A.apy.toFixed(2)}%`, sub: "年化收益率" },
                    { label: "最优目标池", value: BEST_TARGET_POOL.name, sub: `APY ${BEST_TARGET_POOL.apy.toFixed(2)}%` },
                    { label: "当前持有资金", value: `${CURRENT_ASSETS.toFixed(2)} mUSDC`, sub: "待分配" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="text-[11px] font-semibold leading-tight text-slate-400">{item.label}</div>
                      <div className="mt-1 break-words text-sm font-black leading-tight text-slate-900">{item.value}</div>
                      <div className="mt-1 text-[11px] leading-tight text-slate-500">{item.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold text-slate-400">Δ APY</div>
                    <div className="mt-1 text-2xl font-black text-emerald-600">+{deltaApy.toFixed(2)}%</div>
                    <div className="mt-1 text-xs text-slate-500">{BEST_TARGET_POOL.name} 高出 {POOL_A.name}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold text-slate-400">预期增益（{WINDOW_HOURS}h 窗口）</div>
                    <div className="mt-1 text-2xl font-black text-slate-900">{expectedGain.toFixed(4)} mUSDC</div>
                    <div className="mt-1 text-xs text-slate-500">
                      = Δ{deltaApy.toFixed(2)}% / 365 / 24 × {WINDOW_HOURS}h × {CURRENT_ASSETS.toFixed(0)} mUSDC
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold text-slate-400">调仓手续费</div>
                    <div className="mt-1 text-2xl font-black text-slate-900">{FEE.toFixed(4)} mUSDC</div>
                    <div className="mt-1 text-xs text-slate-500">= 固定 Gas 0.0124 + 迁移资金 × 0.00145%</div>
                  </div>
                </div>
              </div>

              {/* 右：系统判断 */}
              <div style={{ width: '256px', flexShrink: 0 }} className={`flex flex-col justify-center rounded-2xl p-4 ${shouldRebalance
                ? "border border-emerald-200 bg-emerald-50"
                : "border border-amber-200 bg-amber-50"
                }`}>
                <div className={`grid h-10 w-10 place-items-center rounded-full text-lg font-black ${shouldRebalance ? "bg-emerald-500 text-white" : "bg-amber-400 text-white"}`}>
                  {shouldRebalance ? "✓" : "~"}
                </div>
                <div className="mt-3">
                  <div className={`text-sm font-bold leading-6 ${shouldRebalance ? "text-emerald-700" : "text-amber-700"}`}>
                    {shouldRebalance ? "系统判断：建议调仓" : "系统判断：暂不调仓"}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    预期增益 {expectedGain.toFixed(4)} {shouldRebalance ? ">" : "<"} 手续费 {FEE.toFixed(4)}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 池子迁移动画 */}
        {activeSection === "anim" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">2</div>
              <h2 className="text-lg font-black text-slate-900">资金迁移演示</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              当前提供 5 个目标池可选。系统会标出当前 APY 最高的池子，但最终迁移到哪个池、迁移全部还是一半，都由用户自己决定。
            </p>

            <div className="mt-5 flex items-stretch gap-4">
              {/* 左：目标池选择，3+2 网格 */}
              <div className="flex-1 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">目标池选择</div>
                    <div className="mt-1 text-xs text-slate-500">从 5 个候选池里选择本次迁移的目标池。</div>
                  </div>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    当前最高 APY：{BEST_TARGET_POOL.name} {BEST_TARGET_POOL.apy.toFixed(2)}%
                  </div>
                </div>
                <div className="mt-4 gap-1.5" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  {TARGET_POOLS.map((pool) => {
                    const active = pool.id === selectedTargetPool.id;
                    const isBest = pool.id === BEST_TARGET_POOL.id;
                    return (
                      <button
                        key={pool.id}
                        type="button"
                        onClick={() => {
                          if (pool.id === selectedTargetPool.id) return;
                          resetMigrationPreview();
                          setSelectedTargetId(pool.id);
                        }}
                        disabled={animating}
                        className={`relative min-w-0 rounded-xl border px-2.5 py-2.5 text-left transition ${active
                          ? "border-[#003689] bg-[#003689]/5 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          } ${animating ? "cursor-not-allowed opacity-70" : ""}`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-[12px] font-bold leading-tight text-slate-900">{pool.name}</div>
                          <div className="mt-2 text-[18px] font-black" style={{ color: pool.color }}>
                            {pool.apy.toFixed(2)}%
                          </div>
                        </div>
                        {isBest ? (
                          <span
                            aria-label="当前最高"
                            className="pointer-events-none absolute z-10 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_1px_3px_rgba(16,185,129,0.35)]"
                            style={{ left: "auto", right: 8, bottom: 8 }}
                          >
                            <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                              <path d="M3.5 8.25 6.4 11.15 12.5 5.05" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 右：建议迁移比例 */}
              <div className="w-72 shrink-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-center">
                <div className="text-sm font-bold text-slate-900">建议迁移比例</div>
                <div className="mt-2 text-xs leading-6 text-slate-500">
                  系统默认建议比例为 100%，你也可以改成 90% 或 80%。
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex items-center justify-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={movePercentInput}
                      onFocus={() => setMovePercentFocused(true)}
                      onBlur={() => setMovePercentFocused(false)}
                      onChange={(event) => {
                        const nextValue = event.target.value.trim();
                        if (nextValue !== "" && !/^\d{0,3}(\.\d{0,2})?$/.test(nextValue)) return;
                        if (nextValue !== "" && Number(nextValue) > 100) return;
                        resetMigrationPreview();
                        setMovePercentInput(nextValue);
                      }}
                      size={Math.max((movePercentInput || "100").length, 3)}
                      disabled={animating}
                      placeholder="输入比例"
                      className={`h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-center text-base font-semibold outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 focus:border-[#003689] focus:ring-2 focus:ring-[#003689]/15 ${movePercentDisplayMuted ? "text-slate-400" : "text-slate-900"}`}
                    />
                    <span className="text-base font-bold text-slate-600">%</span>
                    <button
                      type="button"
                      onClick={openPreviewDialog}
                      disabled={animating || rebalanced || !canExecuteRebalance}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-[#003689] px-4 text-[13px] font-bold text-white shadow-[0_4px_0_#002060] transition-all hover:bg-[#002f79] active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      下一步
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">
                    当前将迁移 {moveAmount.toFixed(2)} mUSDC，当前池预计保留 {currentPoolAfterAmount.toFixed(2)} mUSDC
                  </div>
                </div>
              </div>
            </div>

            {/* 资金迁移预览区块暂时隐藏，保留代码以便后续恢复
            <div className="mt-6 flex flex-col items-center gap-6">
              <div className="flex w-full max-w-3xl items-center justify-between gap-4">
                <div className={`flex-1 rounded-2xl border-2 p-4 text-center transition-all duration-500 ${
                  animStep === "done" || rebalanced
                    ? "border-slate-200 bg-slate-50"
                    : "border-[#6366f1] bg-[#eef2ff]"
                }`}>
                  <div className="text-xs font-bold text-slate-500">当前池</div>
                  <div className="mt-1 text-base font-black text-slate-900">{POOL_A.name}</div>
                  <div className="mt-1 text-2xl font-black text-[#6366f1]">{POOL_A.apy.toFixed(2)}%</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {animStep === "done" || rebalanced
                      ? `${currentPoolAfterAmount.toFixed(2)} mUSDC`
                      : `预计保留 ${currentPoolAfterAmount.toFixed(2)} mUSDC`}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <div className={`h-0.5 w-16 transition-all duration-700 ${
                    animStep === "moving" || animStep === "done" || rebalanced
                      ? "bg-emerald-500 scale-x-100"
                      : animStep === "checking"
                      ? "bg-amber-400 scale-x-75"
                      : "bg-slate-200"
                  }`} />
                  <div className={`text-[10px] font-bold transition-colors duration-300 ${
                    animStep === "checking" ? "text-amber-600" :
                    (animStep === "moving" || animStep === "done" || rebalanced) ? "text-emerald-600" :
                    "text-slate-400"
                  }`}>
                    {animStep === "checking" ? "验证中..." :
                     animStep === "moving" ? "迁移中..." :
                     (animStep === "done" || rebalanced) ? "已完成" : "待触发"}
                  </div>
                  <div className="text-base">
                    {animStep === "checking" ? "⟳" :
                     animStep === "moving" ? "→" :
                     (animStep === "done" || rebalanced) ? "✓" : "→"}
                  </div>
                </div>

                <div className={`flex-1 rounded-2xl border-2 p-4 text-center transition-all duration-500 ${
                  animStep === "done" || rebalanced
                    ? "bg-amber-50"
                    : "border-slate-200 bg-slate-50"
                }`} style={animStep === "done" || rebalanced ? { borderColor: selectedTargetPool.color } : undefined}>
                  <div className="text-xs font-bold text-slate-500">目标池</div>
                  <div className="mt-1 text-base font-black text-slate-900">{selectedTargetPool.name}</div>
                  <div className="mt-1 text-2xl font-black" style={{ color: selectedTargetPool.color }}>{selectedTargetPool.apy.toFixed(2)}%</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {animStep === "done" || rebalanced
                      ? `${targetPoolAfterAmount.toFixed(2)} mUSDC`
                      : `预计迁入 ${targetPoolAfterAmount.toFixed(2)} mUSDC`}
                  </div>
                </div>
              </div>
            </div>
            */}

            <div className="mt-6 flex flex-col items-center gap-6">
              {animStep !== "idle" ? (
                <div className={`rounded-full px-4 py-1.5 text-sm font-semibold ${animStep === "checking" ? "bg-amber-100 text-amber-700" :
                  animStep === "moving" ? "bg-blue-100 text-blue-700" :
                    "bg-emerald-100 text-emerald-700"
                  }`}>
                  {animStep === "checking" && "正在校验当前选择的收益与手续费..."}
                  {animStep === "moving" && `正在将 ${moveAmount.toFixed(2)} mUSDC 从 ${POOL_A.name} 迁至 ${selectedTargetPool.name}...`}
                  {animStep === "done" && `调仓完成！已迁移 ${moveAmount.toFixed(2)} mUSDC，手续费 ${selectedFee.toFixed(4)} mUSDC，24h 预计净变化 ${selectedNetGain >= 0 ? "+" : ""}${selectedNetGain.toFixed(4)} mUSDC`}
                </div>
              ) : rebalanced ? (
                <div className="rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-semibold text-emerald-700">
                  已按 {movePercentLabel} 迁移至 {selectedTargetPool.name}，当前目标池年化 {selectedTargetPool.apy.toFixed(2)}%
                </div>
              ) : null}
            </div>

            {/* 公共 backdrop（只负责背景 + overflow） */}
            {/* {modalBackdropOpen ? createPortal(

              document.body
            ) : null} */}

            {/* 预览弹窗 - 已修复点击事件 */}
            {previewDialogOpen ? (
              <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4"
                onClick={() => setPreviewDialogOpen(false)}
              >
                <div
                  className={`w-[400px] rounded-2xl border bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.24)] ${previewToneClass}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-400">REBALANCE PREVIEW</div>
                      <h3 className="mt-2 text-xl font-black text-slate-900">本次迁移预估</h3>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-[11px] font-bold ${previewBadgeClass}`}>
                      {previewConclusion}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-4">
                      <span>目标池</span>
                      <span className="text-right font-semibold text-slate-800">
                        {selectedTargetPool.name} / {selectedTargetPool.apy.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>APY 差值</span>
                      <span className="font-semibold text-slate-800">+{selectedDeltaApy.toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>迁移资金</span>
                      <span className="font-semibold text-slate-800">{moveAmount.toFixed(2)} mUSDC</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>24h 预计增益</span>
                      <span className="font-semibold text-slate-800">{selectedExpectedGain.toFixed(4)} mUSDC</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>预计手续费</span>
                      <span className="font-semibold text-slate-800">{selectedFee.toFixed(4)} mUSDC</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>预计净变化</span>
                      <span className={`font-semibold ${selectedNetGain >= 0 ? "text-emerald-700" : "text-amber-700"}`}>
                        {selectedNetGain >= 0 ? "+" : ""}
                        {selectedNetGain.toFixed(4)} mUSDC
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setPreviewDialogOpen(false)}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      回到上一步
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewConfirm}
                      className="inline-flex items-center justify-center rounded-xl bg-[#003689] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#002f79]"
                    >
                      执行调仓
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* 损失警告弹窗 - 已修复点击事件 */}
            {lossWarningOpen ? (
              <div
                className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-6 bg-slate-900/45 backdrop-blur-[2px]"
                onClick={() => setLossWarningOpen(false)}
              >
                <div
                  className="w-full max-w-md rounded-[28px] border border-amber-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-700">
                    增益无法覆盖手续费
                  </div>
                  <h3 className="mt-3 text-xl font-black text-slate-900">确定继续执行吗？</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    按当前估算，本次迁移的预计净变化为
                    <span className="mx-1 font-bold text-amber-700">{selectedNetGain.toFixed(4)} mUSDC</span>
                    ，继续执行将面临损失。
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    如果你只是想重新调整比例，可以先回到上一步，把迁移比例改成 90%、80% 或其他值后再预览。
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLossWarningOpen(false);
                        setPreviewDialogOpen(true);
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      回到上一步
                    </button>
                    <button
                      type="button"
                      onClick={handleLossConfirm}
                      className="inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-amber-600"
                    >
                      仍然执行调仓
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* APY 历史曲线 */}
        {activeSection === "apy" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">3</div>
              <h2 className="text-lg font-black text-slate-900">过去 72 小时 APY 走势</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {BEST_TARGET_POOL.name} 持续高于 {POOL_A.name}，利率差可覆盖手续费。
            </p>
            <ReactECharts option={apyChartOption} style={{ height: 280, marginTop: 12 }} notMerge />
          </section>
        )}

        {/* 收益对比曲线 */}
        {activeSection === "comp" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">4</div>
              <h2 className="text-lg font-black text-slate-900">调仓 vs 未调仓 — 收益对比</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              绿线为实际调仓路径，红虚线为"如果 32 小时前没有调仓"的假设路径。差距随时间扩大。
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(() => {
                const last = comparisonHistory[comparisonHistory.length - 1];
                const gap = last ? last.actual - last.hold : 0;
                return [
                  { label: "已调仓最终资金", value: `${last?.actual.toFixed(4) ?? "--"} mUSDC`, color: "emerald" },
                  { label: "未调仓最终资金（假设）", value: `${last?.hold.toFixed(4) ?? "--"} mUSDC`, color: "rose" },
                  { label: "调仓多赚", value: `+${gap.toFixed(4)} mUSDC`, color: "blue" },
                ];
              })().map((item) => (
                <div key={item.label} className={`rounded-xl border p-3 ${item.color === "emerald" ? "border-emerald-200 bg-emerald-50" :
                  item.color === "rose" ? "border-rose-200 bg-rose-50" :
                    "border-blue-200 bg-blue-50"
                  }`}>
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className={`mt-1 text-lg font-black ${item.color === "emerald" ? "text-emerald-700" :
                    item.color === "rose" ? "text-rose-700" :
                      "text-blue-700"
                    }`}>{item.value}</div>
                </div>
              ))}
            </div>

            <ReactECharts option={compChartOption} style={{ height: 280, marginTop: 16 }} notMerge />
          </section>
        )}

        {/* 决策记录 */}
        {activeSection === "log" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">5</div>
              <h2 className="text-lg font-black text-slate-900">本次决策记录</h2>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    {["检查项目", "数值", "结论"].map((h) => (
                      <th key={h} className="border-b border-slate-200 px-4 py-2.5 text-left text-xs font-bold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "扫描时间", val: fmtTime(NOW), conclusion: "已触发检查", ok: true },
                    { label: "当前池 APY", val: `${POOL_A.apy.toFixed(2)}%（${POOL_A.name}）`, conclusion: "记录基准", ok: true },
                    { label: "最优池 APY", val: `${BEST_TARGET_POOL.apy.toFixed(2)}%（${BEST_TARGET_POOL.name}）`, conclusion: `高出 ${deltaApy.toFixed(2)}%`, ok: true },
                    { label: "预期增益（24h）", val: `${expectedGain.toFixed(4)} mUSDC`, conclusion: "大于手续费", ok: shouldRebalance },
                    { label: "调仓手续费", val: `${FEE.toFixed(4)} mUSDC`, conclusion: "已计算", ok: true },
                    { label: "最终决策", val: shouldRebalance ? "执行调仓" : "保持仓位", conclusion: shouldRebalance ? "增益 > 手续费" : "增益 ≤ 手续费", ok: shouldRebalance },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                      <td className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">{row.label}</td>
                      <td className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{row.val}</td>
                      <td className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
                        {row.conclusion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </ConsoleLayout>
  );
}
