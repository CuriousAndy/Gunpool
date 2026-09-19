"use client";

import { useMemo, useState } from "react";

import { PublicLayout } from "@/src/components/layout/public-layout";

const TERMS = [
  { name: "APY", desc: "年化收益率，用于衡量资金池在年度尺度下的收益水平。" },
  { name: "bps", desc: "基点（Basis Points），100 bps = 1%。用于表示手续费费率与利率差。" },
  { name: "调仓", desc: "系统将资金从当前池迁移到目标池，以追求更高净收益的行为。" },
  { name: "预期增益", desc: "在设定观察窗口内，由利率差估算出的潜在收益值。" },
  { name: "手续费覆盖", desc: "当预期增益大于调仓手续费时，策略允许触发调仓。" },
];

const RULES = [
  "判定目标池是否优于当前池。",
  "计算利率差、预期增益和手续费。",
  "仅当“预期增益 > 手续费”时触发调仓。",
  "执行后记录调仓时间、池子迁移和关键参数。",
  "结果同步到控制台图表与调仓分析页。",
];

const READING_GUIDE = [
  {
    title: "多池 APY 曲线",
    desc: "用于观察各候选池的收益变化趋势和交叉时刻，适合回答“为什么要换池”。",
    tone: "blue",
  },
  {
    title: "调仓时间线",
    desc: "显示每个决策时点的利率差与是否执行调仓，适合回答“何时换池”。",
    tone: "teal",
  },
  {
    title: "资金变化表",
    desc: "展示按时间粒度统计的存入、取出、新增利息、累计利息与累计金额。",
    tone: "amber",
  },
];

const STRATEGY_METRICS = [
  {
    name: "最终资产",
    formula: "finalAssets = Number(assets.toFixed(4))",
    desc:
      "仿真循环结束时的资产值。assets 从 startAssets 开始，每个时间步先判断是否调仓并扣手续费，再按 active 池年化折算增长。",
  },
  {
    name: "净收益",
    formula: "netGain = Number((assets - startAssets).toFixed(4))",
    desc:
      "结束资产减去起始资产，单位 mUSDC。由于表格按固定小数位显示，人工相减可能出现极小舍入差异。",
  },
  {
    name: "净收益率",
    formula: "netReturnPct = startAssets > 0 ? Number(((netGain / startAssets) * 100).toFixed(2)) : 0",
    desc: "净收益相对起始资产的百分比；当起始资产为 0 时返回 0，避免除零。",
  },
  {
    name: "调仓次数",
    formula: "rebalanceCount += 1 (only if canRebalance)",
    desc:
      "仅在真实触发调仓时累加。触发条件：candidate != active 且 thresholdOk 且 expectedGain > fee。",
  },
  {
    name: "手续费累计",
    formula: "totalFees = Number(fees.toFixed(4)); fees += fee",
    desc:
      "仿真期间所有已执行调仓手续费之和。单次手续费 fee = max(feeMinUsdc, assets * feeRateBps / 10000)。",
  },
];

const STRATEGY_FINAL_ASSET_NOTES = [
  {
    title: "1) 1241 不是一天涨出来的",
    desc: "策略页默认使用滚动区间：从当前时间往前 365 天开始仿真，而不是只跑 24 小时。",
  },
  {
    title: "2) 表里的 24h/48h/96h 是“判断窗口”，不是回测总时长",
    desc:
      "例如“60m / 24h / ...”中的 24h 表示预计增益覆盖手续费时用的观察窗口长度，不代表整段仿真只有 24 小时。",
  },
  {
    title: "3) 最终资产以“已确认”的本金假设为准",
    desc:
      "策略页采用“确认/取消”模式。你改了本金后，必须点“确认”才会重算三张表；不确认时仍按上次已确认值计算。",
  },
  {
    title: "4) 默认口径",
    desc: "如果不改输入，默认按本金 1000 mUSDC 计算，所以会看到类似 1000 -> 1241.x 的结果。",
  },
];

const FEE_MIN_EXPLANATIONS = [
  {
    title: "1) 默认配置就是 0",
    desc:
      "系统的调仓手续费下限来自后端配置项 REBALANCE_FEE_MIN_USDC，默认值为 0，因此会显示为 0.0000 mUSDC。",
  },
  {
    title: "2) 当前手续费模型是“下限 vs 百分比”取最大",
    desc:
      "计算公式为 fee = max(minFee, assetsBefore * feeRateBps / 10000)。当 minFee=0 时，模型退化为纯百分比手续费。",
  },
  {
    title: "3) 0.0000 是四位小数显示口径",
    desc:
      "页面统一按 4 位小数展示，因此 0 会显示为 0.0000。若你把最低手续费改为 0.05，则会显示 0.0500。",
  },
  {
    title: "4) “链上基准最低手续费”不等于真实 Gas",
    desc:
      "这里是策略模型中的手续费下限参数，用于调仓判定；真实链上 Gas 由“Gas 假设”单独建模并计入对比结果。",
  },
];

const FLOW_STEPS = [
  "进入“钱包登录”并连接钱包。",
  "在“控制台”查看状态并执行存入/取出操作。",
  "在“调仓分析”查看真实调仓记录并定位到对应利率时刻。",
  "在“策略对比”查看不同参数与算法实验结果。",
  "在“系统评估”查看优缺点与局限性说明。",
];

const CONSOLE_GUIDE = [
  {
    title: "先确认连接状态",
    desc: "进入控制台后第一眼先看钱包是否已连接、地址是否显示、网络是否和演示环境一致，避免后面按钮能点但交易发不出去。",
  },
  {
    title: "当前池子就是叙事起点",
    desc: "页面上显示的 active pool 决定了资金此刻停留在哪里，后续解释“为什么要调仓”都要从这个起点往后讲。",
  },
  {
    title: "资产数字要连着动作一起解释",
    desc: "存入会扩大策略本金，取出会减少本金；展示时把操作和资产变化放在同一段话里，评委更容易跟上。",
  },
  {
    title: "状态栏回答系统有没有在工作",
    desc: "最近一次调仓、同步状态、关键合约状态这些信息更适合回答“系统现在运行到哪一步了”。",
  },
  {
    title: "先讲结果，再讲按钮",
    desc: "演示时先让人看到资产、池子和状态，再补一句按钮对应哪类链上动作，表达会更稳。",
  },
];

const ANALYSIS_GUIDE = [
  {
    title: "1) 先锁定时间点",
    desc: "先找到那次调仓发生的具体时刻，再回看该时刻前后的池子收益变化，时间点是整段解释的锚点。",
  },
  {
    title: "2) 再看从哪个池切到哪个池",
    desc: "把 source pool 和 target pool 说清楚，评委才知道系统不是在“频繁乱切”，而是在做有方向的迁移。",
  },
  {
    title: "3) 用预期增益对比手续费",
    desc: "核心不是单看 APY 谁高，而是说明 expected gain 是否覆盖 rebalance fee，这才是系统真正触发调仓的门槛。",
  },
  {
    title: "4) 没调仓同样是有效结果",
    desc: "如果某个时刻没有发生迁移，也要说明是因为手续费覆盖不足或候选池不占优，系统的“克制”本身就是决策结果。",
  },
  {
    title: "5) 最后落到资产变化",
    desc: "把这次调仓如何影响后续资产累计、手续费支出和净收益补上，整条因果链才闭合。",
  },
];

const LIMIT_NOTES = [
  {
    title: "历史收益不等于未来收益",
    desc: "系统依据历史与当前可观测利率做判断，但任何回测或仿真结果都不能直接等价为未来真实收益承诺。",
  },
  {
    title: "手续费模型是简化后的现实",
    desc: "页面里的手续费参数服务于策略判定，不等于链上所有真实成本；真实执行还会受到 gas、拥堵和滑点影响。",
  },
  {
    title: "频繁调仓会放大成本",
    desc: "如果参数设置过于激进，虽然切换次数会变多，但累计手续费也会上升，净收益不一定更好。",
  },
  {
    title: "流动性与退出速度存在约束",
    desc: "真实池子可能面临提款延迟、额度限制或流动性变化，因此系统设计不能只追求账面上的最高 APY。",
  },
  {
    title: "数据同步可能有延迟",
    desc: "收益率、资产和状态都依赖数据抓取与刷新频率，所以演示时要明确这是“当前同步到的最近状态”。",
  },
  {
    title: "参数好看不代表鲁棒",
    desc: "某一组参数在一个时间区间里表现突出，不代表在所有市场阶段都最优；因此比较时更看重稳定性与解释性。",
  },
];

const WALLET_TROUBLESHOOTING = [
  {
    title: "1) 先确认钱包是否真正连接",
    desc: "如果页面没有显示地址、余额或连接状态，先不要继续演示交易按钮，先把连接动作补完整。",
  },
  {
    title: "2) 再确认网络是否一致",
    desc: "钱包切到错误链时，最常见现象是页面能打开，但合约读取或交易签名会异常，所以先看链 ID 和演示环境是否一致。",
  },
  {
    title: "3) 按钮灰掉通常不是前端坏了",
    desc: "很多时候是前置条件没满足，比如未连接、金额为空、授权未完成，讲清前置条件会比直接重复点击更专业。",
  },
  {
    title: "4) 交易慢要区分“已发出”和“未发出”",
    desc: "如果钱包已经弹窗或链上已有 pending 状态，说明请求已送出；如果连钱包弹窗都没有，问题通常还在本地连接侧。",
  },
  {
    title: "5) 演示时准备一套兜底话术",
    desc: "可以直接说“这里依赖钱包签名和链上确认，若网络拥堵会稍慢，我先继续解释判定逻辑”，这样节奏不会被卡死。",
  },
];

const PARAMETER_GUIDE = [
  {
    title: "调仓频率",
    desc: "频率越高，系统检查机会越多，但也更容易提高交易次数和手续费负担，所以它不是越小越好。",
  },
  {
    title: "观察窗口",
    desc: "24h、48h、96h 这类窗口决定系统用多长时间估算未来收益，窗口越长，判断通常越平滑，但反应也可能更慢。",
  },
  {
    title: "手续费比例",
    desc: "这个参数直接抬高调仓门槛；当 feeRate 提高时，只有收益优势更明显的候选池才值得切换。",
  },
  {
    title: "最低手续费",
    desc: "它像一个保底成本，避免系统在极小本金或极小利差下频繁做出看似划算、实际不值得的迁移。",
  },
  {
    title: "本金规模",
    desc: "本金越大，绝对收益和绝对手续费都会一起变化，所以解释结果时最好同时说“百分比变化”和“金额变化”。",
  },
  {
    title: "参数不是孤立生效",
    desc: "真正的结果来自频率、窗口、手续费和本金的组合，答辩时不要把某一个参数单独神化成决定性因素。",
  },
];

const DEFENSE_SCRIPT = [
  {
    title: "开场先讲问题",
    desc: "先说明项目要解决的是“资金应停留在哪个池子，什么时候值得迁移”，让听的人知道系统不是做图，而是在做决策。",
  },
  {
    title: "第二步讲规则",
    desc: "用最短的话讲清楚：找更优池、估算预期增益、比较手续费、满足条件才调仓，这样后面的页面就都有主线了。",
  },
  {
    title: "第三步讲控制台",
    desc: "展示连接状态、当前池子和资产变化，让评委先看到系统是活的、可操作的、和链上动作有关联的。",
  },
  {
    title: "第四步讲分析页",
    desc: "挑一条具体调仓记录，把时间点、池子切换、收益差和手续费覆盖关系串成一个完整案例。",
  },
  {
    title: "结尾讲边界",
    desc: "最后主动补一句模型局限、数据延迟和真实 gas 偏差，通常会让整个项目显得更稳、更可信。",
  },
];

type HelpPanelId =
  | "terms"
  | "rules"
  | "reading"
  | "flow"
  | "metrics"
  | "faq"
  | "console"
  | "analysis"
  | "limits"
  | "wallet"
  | "params"
  | "defense";

const HELP_PANELS: Array<{
  id: HelpPanelId;
  title: string;
  summary: string;
  description: string;
}> = [
  {
    id: "terms",
    title: "术语解释",
    summary: "高频名词",
    description: "先统一几个高频名词，后面页面里的表格、图表、规则都围绕这些词展开。",
  },
  {
    id: "rules",
    title: "规则说明",
    summary: "调仓决策顺序",
    description: "这一块适合在答辩时直接照着讲，逻辑顺序就是系统的决策顺序。",
  },
  {
    id: "reading",
    title: "读图说明",
    summary: "图表怎么看",
    description: "这三张卡分别对应答辩里最常被问到的三类图表。",
  },
  {
    id: "flow",
    title: "系统使用说明",
    summary: "演示流程",
    description: "如果评委想先看完整流程，可以直接按这 5 步走。",
  },
  {
    id: "metrics",
    title: "参数测试指标说明",
    summary: "策略页核心指标",
    description: "对应“策略对比与参数测试”页中的核心指标，下方口径与页面计算代码一致。",
  },
  {
    id: "faq",
    title: "常见问题",
    summary: "答辩高频问法",
    description: "把最常见的追问拆开解释，方便答辩时快速定位到对应答案。",
  },
  {
    id: "console",
    title: "控制台看板说明",
    summary: "登录后先看哪里",
    description: "这一块聚焦控制台首页，适合快速回答“连接后先看什么、先讲什么、先操作什么”。",
  },
  {
    id: "analysis",
    title: "调仓分析讲解",
    summary: "事件记录怎么讲",
    description: "如果评委盯着某一次调仓追问，可以按这里的顺序把时间点、原因和结果串起来。",
  },
  {
    id: "limits",
    title: "系统边界与局限",
    summary: "哪些不能夸大",
    description: "提前把模型边界、数据约束和现实限制说清楚，反而会让整个系统更可信。",
  },
  {
    id: "wallet",
    title: "钱包连接排查",
    summary: "连不上时看这里",
    description: "这一块专门处理演示时最容易打断节奏的钱包、网络和按钮状态问题，适合临场快速排查。",
  },
  {
    id: "params",
    title: "参数解释指南",
    summary: "参数该怎么讲",
    description: "把频率、窗口、手续费和本金这些输入项拆开解释，答辩时不容易被追问到卡住。",
  },
  {
    id: "defense",
    title: "答辩讲述顺序",
    summary: "五步讲清项目",
    description: "如果你想把整套系统讲得更顺，可以直接按这套顺序把问题、规则、演示和边界一路串下来。",
  },
];

function toneCardClass(tone: "blue" | "teal" | "amber"): string {
  if (tone === "blue") return "border-[#003689]/15 bg-[#eef4ff]";
  if (tone === "teal") return "border-teal-200 bg-teal-50";
  return "border-amber-200 bg-amber-50";
}

function FormulaCard({
  name,
  formula,
  desc,
}: {
  name: string;
  formula: string;
  desc: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-bold text-slate-900">{name}</div>
      <code className="mt-3 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-800">
        {formula}
      </code>
      <div className="mt-3 text-xs leading-6 text-slate-600">{desc}</div>
    </article>
  );
}

function FAQColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "blue" | "amber";
  items: Array<{ title: string; desc: string }>;
}) {
  const toneClass =
    tone === "blue"
      ? "border-[#003689]/15 bg-[linear-gradient(180deg,rgba(238,244,255,0.92),rgba(255,255,255,1))]"
      : "border-amber-200 bg-[linear-gradient(180deg,rgba(255,247,237,0.95),rgba(255,255,255,1))]";

  const headingClass = tone === "blue" ? "text-[#003689]" : "text-amber-700";

  return (
    <article className={`rounded-[24px] border p-5 ${toneClass}`}>
      <h3 className={`text-lg font-black ${headingClass}`}>{title}</h3>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]"
          >
            <div className="text-sm font-bold text-slate-900">{item.title}</div>
            <div className="mt-2 text-xs leading-6 text-slate-600">{item.desc}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

function HelpTopicButton({
  item,
  active,
  onClick,
}: {
  item: (typeof HELP_PANELS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[24px] border px-5 py-5 text-left transition ${
        active
          ? "border-[#003689]/25 bg-[#eef4ff] shadow-[0_18px_34px_rgba(0,54,137,0.10)]"
          : "border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.05)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_34px_rgba(15,23,42,0.08)]"
      }`}
    >
      <div className={`text-[11px] font-semibold tracking-[0.18em] ${active ? "text-[#003689]" : "text-slate-400"}`}>
        HELP TOPIC
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className={`text-lg font-medium ${active ? "text-[#003689]" : "text-slate-900"}`}>{item.title}</div>
        <div className="text-sm leading-6 text-slate-500">{item.summary}</div>
      </div>
    </button>
  );
}

function renderPanelContent(activePanel: HelpPanelId) {
  switch (activePanel) {
    case "terms":
      return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TERMS.map((term) => (
            <article key={term.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">{term.name}</div>
              <div className="mt-2 text-xs leading-6 text-slate-600">{term.desc}</div>
            </article>
          ))}
        </div>
      );
    case "rules":
      return (
        <div className="grid gap-3">
          {RULES.map((rule, idx) => (
            <article key={rule} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">
                {idx + 1}
              </div>
              <div className="pt-1 text-sm leading-7 text-slate-700">{rule}</div>
            </article>
          ))}
        </div>
      );
    case "reading":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          {READING_GUIDE.map((item) => (
            <article
              key={item.title}
              className={`rounded-[24px] border p-4 ${toneCardClass(item.tone as "blue" | "teal" | "amber")}`}
            >
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-3 text-xs leading-6 text-slate-700">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "flow":
      return (
        <div className="grid gap-3">
          {FLOW_STEPS.map((step, idx) => (
            <article key={step} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{`Step ${idx + 1}`}</div>
              <div className="mt-2 text-sm leading-7 text-slate-700">{step}</div>
            </article>
          ))}
        </div>
      );
    case "console":
      return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CONSOLE_GUIDE.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] p-4"
            >
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-3 text-xs leading-6 text-slate-600">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "analysis":
      return (
        <div className="grid gap-3">
          {ANALYSIS_GUIDE.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-[#003689]/12 bg-[linear-gradient(180deg,rgba(238,244,255,0.92),rgba(255,255,255,1))] p-4"
            >
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-2 text-xs leading-6 text-slate-600">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "limits":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {LIMIT_NOTES.map((item) => (
            <article key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-2 text-xs leading-6 text-slate-600">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "wallet":
      return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {WALLET_TROUBLESHOOTING.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-amber-200 bg-[linear-gradient(180deg,rgba(255,247,237,0.92),rgba(255,255,255,1))] p-4"
            >
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-3 text-xs leading-6 text-slate-600">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "params":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {PARAMETER_GUIDE.map((item) => (
            <article
              key={item.title}
              className="rounded-[24px] border border-teal-200 bg-[linear-gradient(180deg,rgba(240,253,250,0.92),rgba(255,255,255,1))] p-4"
            >
              <div className="text-sm font-black text-slate-900">{item.title}</div>
              <div className="mt-2 text-xs leading-6 text-slate-600">{item.desc}</div>
            </article>
          ))}
        </div>
      );
    case "defense":
      return (
        <div className="grid gap-3">
          {DEFENSE_SCRIPT.map((item, idx) => (
            <article
              key={item.title}
              className="flex gap-3 rounded-[24px] border border-[#003689]/12 bg-[linear-gradient(180deg,rgba(238,244,255,0.92),rgba(255,255,255,1))] p-4"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#003689] text-sm font-black text-white">
                {idx + 1}
              </div>
              <div>
                <div className="text-sm font-black text-slate-900">{item.title}</div>
                <div className="mt-2 text-xs leading-6 text-slate-600">{item.desc}</div>
              </div>
            </article>
          ))}
        </div>
      );
    case "metrics":
      return (
        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] p-4">
          <div className="text-sm leading-7 text-slate-600">
            页面中的
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs text-slate-800">runSimulation</code>
            负责输出最终资产、净收益、净收益率、调仓次数与手续费累计，下方逐项解释其含义。
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {STRATEGY_METRICS.map((item) => (
              <FormulaCard key={item.name} name={item.name} formula={item.formula} desc={item.desc} />
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-[#003689]/12 bg-[#eef4ff] p-4 text-xs leading-6 text-slate-700">
            <div className="text-sm font-bold text-slate-900">关键中间量</div>
            <div className="mt-2">
              <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">
                expectedGain = assets * max(0, futureFactor(candidate, windowHours) - futureFactor(active, windowHours))
              </code>
            </div>
            <div className="mt-2">
              它会与
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">
                fee = max(feeMinUsdc, assets * feeRateBps / 10000)
              </code>
              对比。只有
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">expectedGain &gt; fee</code>
              时才会计入一次调仓。
            </div>
            <div className="mt-2">
              仿真步长为
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">
                stepMs = max(60_000, frequencyMinutes * 60_000)
              </code>
              ，并在
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">[startMs, endMs]</code>
              内逐步迭代。
            </div>
          </div>
        </div>
      );
    case "faq":
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <FAQColumn title="为什么最终资产会出现 1241+" tone="blue" items={STRATEGY_FINAL_ASSET_NOTES} />
          <FAQColumn title="为什么链上基准最低手续费是 0.0000 mUSDC" tone="amber" items={FEE_MIN_EXPLANATIONS} />
        </div>
      );
    default:
      return null;
  }
}

export default function HelpPage() {
  const [activePanel, setActivePanel] = useState<HelpPanelId | null>(null);
  const activeMeta = useMemo(
    () => HELP_PANELS.find((item) => item.id === activePanel) ?? null,
    [activePanel]
  );

  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          {HELP_PANELS.map((item) => (
            <HelpTopicButton
              key={item.id}
              item={item}
              active={activePanel === item.id}
              onClick={() => setActivePanel((current) => (current === item.id ? null : item.id))}
            />
          ))}
        </div>

        {activeMeta ? (
          <section className="rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-6 sm:px-8 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-semibold tracking-[0.18em] text-[#003689]">ACTIVE TOPIC</div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-[24px] font-medium text-slate-900 sm:text-[28px]">{activeMeta.title}</h2>
                  <span className="text-sm leading-6 text-slate-500">{activeMeta.summary}</span>
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{activeMeta.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setActivePanel(null)}
                className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                收起内容
              </button>
            </div>
            <div className="px-6 py-6 sm:px-8">{renderPanelContent(activeMeta.id)}</div>
          </section>
        ) : null}
      </section>
    </PublicLayout>
  );
}
