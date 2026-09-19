"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { MarketApyApiPayload, RebalanceDecisionPayload } from "@/src/lib/market-api-types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const safeSeconds = Math.floor(seconds);
  if (safeSeconds % 86_400 === 0) return `${safeSeconds / 86_400} 天`;
  if (safeSeconds % 3_600 === 0) return `${safeSeconds / 3_600} 小时`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60} 分钟`;
  return `${safeSeconds} 秒`;
}

function getReasonLabel(reason: string): string {
  if (reason === "already_best") return "当前池已是最优";
  if (reason === "gain_below_fee") return "预期增益不足以覆盖手续费";
  if (reason === "rebalance_executed") return "增益覆盖手续费，已执行调仓";
  return reason || "--";
}

function buildConclusion(decision: RebalanceDecisionPayload | null): string {
  if (!decision) return "暂时没有可用的最新决策数据。";

  const delta = decision.deltaBps / 100;
  const windowText = formatDuration(decision.windowSeconds);

  if (decision.shouldRebalance) {
    return `满足触发条件：Δ利率 ${delta.toFixed(2)}%，预期增益 ${decision.expectedGain.toFixed(
      4
    )} mUSDC，高于手续费 ${decision.rebalanceFee.toFixed(4)} mUSDC，当前增益窗口为 ${windowText}。`;
  }

  return `系统建议保持当前仓位：${getReasonLabel(decision.reason)}，当前增益窗口为 ${windowText}。`;
}

export function HomeInsightsSection() {
  const [payload, setPayload] = useState<MarketApyApiPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadInsights() {
      try {
        const response = await fetch("/api/market-apy?decisionLimit=3000", { cache: "no-store" });
        const nextPayload = (await response.json()) as MarketApyApiPayload;

        if (!response.ok || !nextPayload.ok) {
          throw new Error(nextPayload.message || `请求失败：${response.status}`);
        }

        if (!active) return;
        setPayload(nextPayload);
        setError("");
      } catch (cause: unknown) {
        if (!active) return;
        const message =
          cause instanceof Error && cause.message ? cause.message : "读取首页实时洞察数据失败";
        setError(message);
      }
    }

    void loadInsights();

    return () => {
      active = false;
    };
  }, []);

  const decisionsDesc = useMemo(
    () => [...(payload?.decisions ?? [])].sort((a, b) => b.t - a.t),
    [payload]
  );
  const latestDecision = decisionsDesc[0] ?? null;
  const latestWindowSeconds = latestDecision?.windowSeconds ?? payload?.systemProfile?.rebalanceWindowSeconds ?? 0;

  const decisions24h = useMemo(() => {
    if (decisionsDesc.length === 0) return 0;
    const latestTimestamp = decisionsDesc[0].t;
    return decisionsDesc.filter((decision) => latestTimestamp - decision.t <= 86_400_000).length;
  }, [decisionsDesc]);

  const metrics = [
    {
      label: "覆盖协议",
      value: payload ? `${payload.pools.length} 个` : "--",
      description: "可被策略引擎纳入比较的实时资金池数量。",
    },
    {
      label: "近 24 小时决策",
      value: payload ? `${decisions24h} 次` : "--",
      description: "系统在最近一天内给出的调仓或保持判断次数。",
    },
    {
      label: "当前最优 APY",
      value: latestDecision ? `${latestDecision.bestApy.toFixed(2)}%` : "--",
      description: "来自最新决策快照的目标池收益率。",
    },
    {
      label: "最近同步",
      value: payload ? formatTime(payload.updatedAt) : "--",
      description: "市场数据和策略结果最近一次写入首页的时间。",
    },
  ];

  return (
    <section id="insights" className="mx-auto mt-10 w-full max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
      <div className="rounded-[34px] border border-slate-900/[0.08] bg-[#fcfaf5]/[0.82] p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#0f3b74]">Live Insights</div>
            <h2 className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:text-4xl">把系统当前状态直接搬到首页。</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
              新首页不只讲概念，也保留实时数据入口。你可以先介绍系统全貌，再顺势切到最新一次调仓判断和关键运行指标。
            </p>
          </div>

          <div className="rounded-full border border-slate-900/10 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600">
            数据来源：`/api/market-apy`
          </div>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[30px] bg-[#10243f] p-6 text-white shadow-[0_25px_55px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Realtime Snapshot</div>
                <h3 className="mt-2 text-2xl font-black">关键指标概览</h3>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.08] px-3 py-1 text-xs font-semibold text-slate-200">
                首页聚合展示
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-[24px] border border-white/10 bg-white/[0.06] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">{metric.label}</div>
                  <div className="mt-3 text-3xl font-black text-white">{metric.value}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{metric.description}</p>
                </div>
              ))}
            </div>

            {error ? (
              <div className="mt-4 rounded-[22px] border border-rose-300/35 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </article>

          <article className="rounded-[30px] border border-slate-900/[0.08] bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Latest Decision</div>
            <h3 className="mt-2 text-2xl font-black text-slate-950">最近一次调仓摘要</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">保留最新决策依据，方便在首页先交代系统目前的判断结果。</p>

            <div className="mt-5 space-y-3 rounded-[26px] bg-[#f7f4ec] p-4">
              <div className="flex items-center justify-between gap-4 border-b border-slate-900/[0.06] pb-3">
                <span className="text-sm font-semibold text-slate-900">决策时间</span>
                <span className="text-sm text-slate-600">{latestDecision ? formatTime(latestDecision.t) : "--"}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-slate-900/[0.06] pb-3">
                <span className="text-sm font-semibold text-slate-900">当前池 → 目标池</span>
                <span className="text-right text-sm text-slate-600">
                  {latestDecision ? `${latestDecision.activePoolName} → ${latestDecision.bestPoolName}` : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-slate-900/[0.06] pb-3">
                <span className="text-sm font-semibold text-slate-900">Δ利率</span>
                <span className="text-sm text-slate-600">
                  {latestDecision ? `${(latestDecision.deltaBps / 100).toFixed(2)}%` : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-slate-900/[0.06] pb-3">
                <span className="text-sm font-semibold text-slate-900">增益时间尺度</span>
                <span className="text-sm text-slate-600">
                  {latestWindowSeconds > 0 ? `${formatDuration(latestWindowSeconds)} (${latestWindowSeconds} 秒)` : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-slate-900">决策标签</span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    latestDecision?.shouldRebalance
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {latestDecision ? (latestDecision.shouldRebalance ? "执行调仓" : "保持仓位") : "暂无数据"}
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-[#0f3b74]/[0.12] bg-[#dfe9f7] px-4 py-4 text-sm leading-7 text-slate-800">
              {buildConclusion(latestDecision)}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/history"
                className="inline-flex rounded-full border border-slate-900/10 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                查看完整历史
              </Link>
              <Link
                href="/principle"
                className="inline-flex rounded-full border border-[#0f3b74]/[0.18] bg-[#0f3b74]/[0.06] px-4 py-2 text-sm font-semibold text-[#0f3b74] transition hover:bg-[#0f3b74]/10"
              >
                查看触发逻辑
              </Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
