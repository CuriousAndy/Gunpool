"use client";

type WalletLoadingModalProps = {
  open: boolean;
  title?: string;
  description?: string;
};

export function WalletLoadingModal({
  open,
  title = "加载中……",
  description = "正在准备演示控制台，请稍候。",
}: WalletLoadingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 px-4">
      <div className="flex w-[360px] max-w-[calc(100vw-2rem)] flex-col items-center rounded-[28px] border border-slate-200 bg-white px-6 py-7 text-center shadow-[0_28px_70px_rgba(15,23,42,0.28)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#003689]/10 text-[#003689]">
          <svg className="h-7 w-7 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-90" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z" />
          </svg>
        </div>

        <h2 className="mt-4 text-[22px] font-black leading-tight text-slate-900">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}
