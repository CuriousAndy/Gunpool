"use client";

import { useState } from "react";

import { PublicLayout } from "@/src/components/layout/public-layout";

const STRENGTHS = [
  "支持自动化调仓，能在多池收益差中执行迁移决策。",
  "策略流程清晰，调仓触发基于“增益覆盖手续费”逻辑。",
  "链上合约与前端联动完整，具备可演示的交互闭环。",
  "具备可视化能力，包含 APY 曲线、调仓时间线和记录追溯。",
  "支持参数与策略实验，便于答辩中进行论证展示。",
];

const LIMITATIONS = [
  "调仓频率仍以离散参数实验为主，动态自适应机制较弱。",
  "策略算法维度有限，尚未引入更复杂预测模型。",
  "手续费建模已覆盖基础场景，但对极端波动情况拟合不足。",
  "真实链上环境适配和跨链测试仍有限，工程化程度需提升。",
  "回测粒度和敏感性分析仍可扩展，结论稳健性有待加强。",
];

const NEXT_STEPS = [
  "引入波动率约束与滑点模型，提升调仓决策稳健性。",
  "增加机器学习或统计预测信号，增强窗口期收益预估能力。",
  "扩展多链与真实测试网部署，验证策略迁移可行性。",
  "增强回测报告体系，补充置信区间与压力场景分析。",
];

export default function AnalysisPage() {
  const [activeView, setActiveView] = useState<"strengths" | "limitations">("strengths");
  const isStrengths = activeView === "strengths";
  const items = isStrengths ? STRENGTHS : LIMITATIONS;

  return (
    <PublicLayout>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveView("strengths")}
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
              isStrengths
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-300 bg-slate-50 text-slate-700"
            }`}
          >
            系统优点
          </button>
          <button
            type="button"
            onClick={() => setActiveView("limitations")}
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
              !isStrengths
                ? "border-amber-600 bg-amber-600 text-white"
                : "border-slate-300 bg-slate-50 text-slate-700"
            }`}
          >
            局限性
          </button>
        </div>

        <article
          className={`mt-4 rounded-2xl border p-5 shadow-[0_10px_26px_rgba(15,23,42,0.06)] ${
            isStrengths ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"
          }`}
        >
          <h2 className={`text-lg font-black ${isStrengths ? "text-emerald-700" : "text-amber-700"}`}>
            {isStrengths ? "系统优点" : "局限性"}
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
            {items.map((item) => (
              <li
                key={item}
                className={`rounded-xl border px-3 py-2 ${
                  isStrengths ? "border-emerald-100 bg-white" : "border-amber-100 bg-white"
                }`}
              >
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
        <h2 className="text-lg font-black text-slate-900">后续优化方向</h2>
        <ol className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
          {NEXT_STEPS.map((item, idx) => (
            <li key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              {idx + 1}. {item}
            </li>
          ))}
        </ol>
      </section>
    </PublicLayout>
  );
}
