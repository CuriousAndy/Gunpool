import { useEffect, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type ActionMode = "deposit" | "withdraw";

type ActionPanelProps = {
  mode: ActionMode;
  onModeChange: (mode: ActionMode) => void;
  editorOpen: boolean;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  depositValue: string;
  withdrawValue: string;
  onDepositValueChange: (value: string) => void;
  onWithdrawValueChange: (value: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  onFillDepositMax: () => void;
  onFillWithdrawMax: () => void;
  walletBalanceText: string;
  vaultBalanceText: string;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  busy: boolean;
  submitDisabled: boolean;
  noticeText?: string;
  noticeTone?: "info" | "success" | "error";
  embedded?: boolean;
  noButtons?: boolean;
};

function parseDisplayAmount(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function ActionDialog({
  editorOpen,
  onCloseEditor,
  children,
}: {
  editorOpen: boolean;
  onCloseEditor: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!editorOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseEditor();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editorOpen, onCloseEditor]);

  if (!editorOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4"
      onClick={onCloseEditor}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-star="true"
        className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_28px_70px_rgba(15,23,42,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ActionPanel({
  mode,
  onModeChange,
  editorOpen,
  onOpenEditor,
  onCloseEditor,
  depositValue,
  withdrawValue,
  onDepositValueChange,
  onWithdrawValueChange,
  onDeposit,
  onWithdraw,
  onFillDepositMax,
  onFillWithdrawMax,
  walletBalanceText,
  vaultBalanceText,
  isConnected,
  isConnecting,
  onConnect,
  busy,
  submitDisabled,
  noticeText,
  noticeTone = "info",
  embedded = false,
  noButtons = false,
}: ActionPanelProps) {
  const isDeposit = mode === "deposit";
  const inputValue = isDeposit ? depositValue : withdrawValue;
  const availableBalanceText = isDeposit ? walletBalanceText : vaultBalanceText;
  const availableBalanceValue = parseDisplayAmount(availableBalanceText);
  const inputAmountValue = parseDisplayAmount(inputValue);
  const hasInput = inputValue.trim().length > 0;
  const exceedsBalance =
    inputAmountValue !== null &&
    availableBalanceValue !== null &&
    inputAmountValue > availableBalanceValue + 1e-9;
  const localErrorText = exceedsBalance ? "余额不足" : "";
  const primaryActionLabel = isDeposit ? "存入" : "取出";
  const actionButtonDisabled = submitDisabled || Boolean(localErrorText) || !hasInput;

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (isDeposit) {
      onDepositValueChange(event.target.value);
    } else {
      onWithdrawValueChange(event.target.value);
    }
  }

  function handleConfirm() {
    if (isDeposit) {
      onDeposit();
    } else {
      onWithdraw();
    }
  }

  return (
    <section
      className={
        embedded
          ? "flex shrink-0 flex-col rounded-none border-0 bg-transparent p-0 shadow-none"
          : "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.08)]"
      }
    >
      {!noButtons ? (
        <div
          className={
            embedded
              ? "flex flex-col items-start gap-2 md:items-end"
              : "flex items-center justify-between gap-3"
          }
        >
          <h2 className={`${embedded ? "text-sm" : "text-base"} font-bold text-slate-900`}>资金操作</h2>

          <div className={`flex items-center ${embedded ? "gap-2" : "gap-2.5"}`}>
            <button
              type="button"
              onClick={() => {
                onModeChange("deposit");
                onOpenEditor();
              }}
              className={`${embedded ? "rounded-full px-4 py-1.5 text-sm" : "rounded-xl border px-5 py-2 text-sm"} font-bold transition ${
                isDeposit
                  ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                  : embedded
                    ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    : "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400"
              }`}
            >
              存入
            </button>
            <button
              type="button"
              onClick={() => {
                onModeChange("withdraw");
                onOpenEditor();
              }}
              className={`${embedded ? "rounded-full px-4 py-1.5 text-sm" : "rounded-xl border px-5 py-2 text-sm"} font-bold transition ${
                !isDeposit
                  ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                  : embedded
                    ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                    : "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400"
              }`}
            >
              取出
            </button>
          </div>
        </div>
      ) : null}

      <ActionDialog editorOpen={editorOpen} onCloseEditor={onCloseEditor}>
        <div>
          <div className="text-xs font-semibold tracking-[0.14em] text-slate-500">FUND ACTION</div>
          <h2 className="mt-3 text-[24px] font-black leading-tight text-slate-900">
            确认{primaryActionLabel}信息
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isDeposit
              ? "请确认本次存入金额，提交后会立即更新演示钱包与机枪池余额。"
              : "请确认本次取出金额，提交后会同步更新演示钱包与机枪池余额。"}
          </p>

          <div className="mt-5 grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-semibold text-slate-500">
                  {isDeposit ? "可用余额" : "可取余额"}
                </div>
                <div className="rounded-full border border-[#003689]/20 bg-[#003689]/8 px-3 py-1 text-xs font-semibold text-[#003689]">
                  {availableBalanceText} mUSDC
                </div>
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-600">
                {isDeposit
                  ? "系统将从演示钱包余额中扣减对应金额，并存入机枪池。"
                  : "系统将从机枪池份额中扣减对应金额，并返还到演示钱包。"}
              </div>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-slate-500">
                {isDeposit ? "存入数量" : "取出数量"}
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
                <input
                  value={inputValue}
                  onChange={onInputChange}
                  inputMode="decimal"
                  placeholder="0.0"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={isDeposit ? onFillDepositMax : onFillWithdrawMax}
                  className="rounded-full border border-[#003689]/20 bg-[#003689]/8 px-3 py-1 text-xs font-semibold text-[#003689] transition hover:bg-[#003689]/12"
                >
                  最大
                </button>
              </div>
            </label>

            {localErrorText ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                {localErrorText}
              </div>
            ) : null}

            {noticeText && noticeTone !== "success" ? (
              <div
                className={`rounded-2xl border px-3 py-2 text-xs leading-5 ${
                  noticeTone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-sky-200 bg-sky-50 text-sky-700"
                }`}
              >
                {noticeText}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500">
                确认信息无误后点击“确认{primaryActionLabel}”，页面将立即刷新最新状态。
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto flex justify-end gap-3 pt-5">
          <button
            type="button"
            onClick={onCloseEditor}
            disabled={busy}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          {!isConnected ? (
            <button
              type="button"
              onClick={onConnect}
              disabled={busy}
              className="rounded-xl bg-[#003689] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#002f79] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConnecting ? "连接中..." : "连接钱包"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={actionButtonDisabled}
              className={
                actionButtonDisabled
                  ? "rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-500"
                  : "rounded-xl bg-[#003689] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#002f79]"
              }
            >
              {busy ? "处理中..." : `确认${primaryActionLabel}`}
            </button>
          )}
        </div>
      </ActionDialog>
    </section>
  );
}

export { toast };
