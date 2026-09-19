"use client";

import { useEffect, useMemo, useState } from "react";

import { shortAddress } from "@/src/lib/contracts";

type WalletMenuProps = {
  address?: string;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function fallbackCopyText(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback for non-secure contexts (e.g. http with IP).
  }
  return fallbackCopyText(text);
}

export function WalletMenu({
  address,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
}: WalletMenuProps) {
  const [open, setOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<"success" | "error" | null>(null);

  const fullAddress = useMemo(() => address ?? "", [address]);

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  async function onCopyAddress() {
    if (!fullAddress) return;
    setOpen(false);
    const ok = await copyText(fullAddress);
    setCopyNotice(ok ? "success" : "error");
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="rounded-xl border border-[#003689] bg-[#003689] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#002f79]"
      >
        {isConnecting ? "连接中..." : "连接钱包"}
      </button>
    );
  }

  return (
    <div className="relative flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
      >
        <span>{shortAddress(fullAddress)}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {copyNotice ? (
        <div
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
            copyNotice === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {copyNotice === "success" ? "复制成功" : "复制失败，请手动复制"}
        </div>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-12 z-50 min-w-[170px] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
          <button
            type="button"
            onClick={onCopyAddress}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
          >
            复制地址
          </button>
          <button
            type="button"
            onClick={() => {
              onDisconnect();
              setOpen(false);
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
          >
            {"断开钱包"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
