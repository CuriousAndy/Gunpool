import Image from "next/image";

type WalletLoginPanelProps = {
  isPending: boolean;
  isConnected: boolean;
  onConnectWallet: () => void | Promise<void>;
  onQuickEnter: () => void | Promise<void>;
  title?: string;
  description?: string;
};

const ENTRY_STEPS = [
  {
    label: "确认身份",
    detail: "默认演示账户信息已预填，可直接继续。",
  },
  {
    label: "进入控制台",
    detail: "登录后立刻查看资金池、调仓分析和策略对比。",
  },
  {
    label: "无需真钱包",
    detail: "全流程为答辩演示模式，不会发起真实链上连接。",
  },
];

const PREVIEW_ITEMS = [
  { title: "调仓分析", detail: "事件追溯、收益拆解、决策摘要" },
  { title: "策略对比", detail: "频率、算法、覆盖窗口实验" },
];

export function WalletLoginPanel({
  isPending,
  isConnected,
  onConnectWallet,
  onQuickEnter,
  title = "机枪池钱包登录",
  description = "以演示身份进入控制台，查看资金池状态、调仓分析与策略对比，不会唤起真实钱包。",
}: WalletLoginPanelProps) {
  return (
    <section className="py-5 sm:py-6">
      <div className="wallet-login-surface relative overflow-hidden rounded-[30px] border border-slate-200/80 shadow-[0_28px_80px_rgba(15,23,42,0.10)] supports-[backdrop-filter]:backdrop-blur-xl">
        <div className="relative grid gap-8 px-5 py-6 sm:px-7 sm:py-7 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.98fr)] lg:gap-10 lg:px-9 lg:py-9">
          <div className="flex flex-col gap-5">
            <div>
              <div className="login-panel-reveal inline-flex items-center gap-2 rounded-full border border-sky-300/70 bg-[linear-gradient(135deg,rgba(219,234,254,0.96),rgba(191,219,254,0.72))] px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-[#0b3b91] shadow-[0_10px_24px_rgba(59,130,246,0.10)]">
                DEMO ACCESS
              </div>

              <h1 className="login-panel-reveal mt-5 w-fit max-w-full whitespace-nowrap text-[28px] font-extrabold leading-[1.08] tracking-[0.05em] text-slate-950 [animation-delay:80ms] sm:text-[32px] lg:text-[40px]">
                {title}
              </h1>

              <p className="login-panel-reveal mt-5 max-w-[58ch] text-sm leading-[1.8] text-slate-600 [animation-delay:160ms] sm:text-[15px]">
                {description}
              </p>

              <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="login-panel-reveal w-full sm:max-w-[308px] [animation-delay:240ms]">
                  <button
                    type="button"
                    onClick={() => void onConnectWallet()}
                    disabled={isPending || isConnected}
                    className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[linear-gradient(135deg,#0b4fbe_0%,#003689_100%)] px-6 text-base font-semibold text-white shadow-none transition duration-200 hover:scale-[1.02] hover:brightness-105 hover:shadow-none active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {!isPending && !isConnected ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <path
                          d="M4 8.25A2.25 2.25 0 0 1 6.25 6h10.9a.85.85 0 0 1 0 1.7h-10.9a.55.55 0 0 0 0 1.1H19a1 1 0 0 1 1 1v6.05A2.25 2.25 0 0 1 17.75 18H6.25A2.25 2.25 0 0 1 4 15.75v-7.5Z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="16.2" cy="12.35" r="1.25" fill="currentColor" stroke="none" />
                      </svg>
                    ) : null}
                    {isPending ? "正在开启演示..." : isConnected ? "已登录，正在进入控制台..." : "连接钱包"}
                  </button>
                  <p className="mt-2 pl-1 text-xs leading-6 text-slate-500">以真实身份进入控制台。</p>
                </div>

                <div className="login-panel-reveal w-full sm:max-w-[240px] [animation-delay:320ms]">
                  <button
                    type="button"
                    onClick={() => void onQuickEnter()}
                    disabled={isPending || isConnected}
                    className="inline-flex h-14 w-full items-center justify-center rounded-2xl border border-[#003689]/18 bg-white/72 px-5 text-sm font-semibold text-[#0c3577] shadow-[0_8px_22px_rgba(15,23,42,0.04)] transition duration-200 hover:scale-[1.02] hover:border-[#0b4fbe]/28 hover:bg-[#eef4ff] hover:shadow-[0_14px_28px_rgba(59,130,246,0.12)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    快速进入
                  </button>
                  <p className="mt-2 pl-1 text-xs leading-6 text-slate-500">跳过身份确认，使用默认演示账户进入。</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {ENTRY_STEPS.map((item, index) => (
                <article
                  key={item.label}
                  className="login-panel-reveal rounded-2xl border border-slate-200/90 bg-white/72 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
                  style={{ animationDelay: `${380 + index * 90}ms` }}
                >
                  <div className="text-[11px] font-bold tracking-[0.18em] text-slate-400">{`0${index + 1}`}</div>
                  <div className="mt-2 text-sm font-bold text-slate-900">{item.label}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="login-panel-reveal rounded-[26px] border border-white/70 bg-[linear-gradient(180deg,rgba(248,251,255,0.96)_0%,rgba(238,244,255,0.88)_100%)] p-4 shadow-[0_20px_46px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.68)] [animation-delay:220ms] sm:p-5">
            <div className="overflow-hidden rounded-[22px] border border-white/80 bg-white p-2.5 shadow-[0_16px_30px_rgba(15,23,42,0.08)] sm:p-3">
              <Image
                src="/vault-pool.png"
                alt="机枪池资金池示意图"
                width={640}
                height={480}
                priority
                className="mx-auto h-[160px] w-auto max-w-full scale-[1.22] transform-gpu rounded-2xl object-contain sm:h-[185px] lg:h-[205px]"
              />
            </div>

            <div className="mt-4 grid gap-3">
              {PREVIEW_ITEMS.map((item, index) => (
                <article
                  key={item.title}
                  className="login-panel-reveal flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
                  style={{ animationDelay: `${460 + index * 90}ms` }}
                >
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#003689] text-xs font-black text-white">
                    {item.title.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-500">{item.detail}</div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
