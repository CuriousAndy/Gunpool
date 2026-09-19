"use client";

import { shortAddress } from "@/src/lib/contracts";

export type DemoLoginProfile = {
  displayName: string;
  walletLabel: string;
  role: string;
};

type WalletConnectModalProps = {
  open: boolean;
  address: string;
  profile: DemoLoginProfile;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onProfileChange: (field: keyof DemoLoginProfile, value: string) => void;
};

export function WalletConnectModal({
  open,
  address,
  profile,
  isPending,
  onClose,
  onConfirm,
  onProfileChange,
}: WalletConnectModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4">
      <div className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_28px_70px_rgba(15,23,42,0.28)]">
        <div>
          <div className="text-xs font-semibold tracking-[0.14em] text-slate-500">DEMO LOGIN</div>
          <h2 className="mt-3 text-[24px] font-black leading-tight text-slate-900">确认登录信息</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            以下信息已默认填好，本次仅模拟登录，不会唤起真实钱包。
          </p>

          <div className="mt-5 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-slate-500">用户名称</span>
              <input
                value={profile.displayName}
                onChange={(event) => onProfileChange("displayName", event.target.value)}
                disabled={isPending}
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-[#003689] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-500">钱包别名</span>
                <input
                  value={profile.walletLabel}
                  onChange={(event) => onProfileChange("walletLabel", event.target.value)}
                  disabled={isPending}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-[#003689] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-500">登录角色</span>
                <input
                  value={profile.role}
                  onChange={(event) => onProfileChange("role", event.target.value)}
                  disabled={isPending}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-[#003689] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-semibold text-slate-500">钱包地址</div>
                <div className="rounded-full border border-[#003689]/20 bg-[#003689]/8 px-3 py-1 text-xs font-semibold text-[#003689]">
                  {shortAddress(address)}
                </div>
              </div>
              <div className="mt-2 break-all text-xs leading-5 text-slate-600">{address}</div>
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
              确认信息无误后点击“确认登录”，系统会直接进入控制台演示页面。
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-3 pt-5">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              加载中...
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isPending}
            className="rounded-xl bg-[#003689] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#002f79] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "登录中..." : "确认登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
