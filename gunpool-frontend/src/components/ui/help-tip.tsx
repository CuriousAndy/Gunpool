"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type HelpTipProps = {
  text: string;
  label?: string;
  variant?: "icon" | "text";
  triggerLabel?: string;
};

export function HelpTip({
  text,
  label = "说明",
  variant = "icon",
  triggerLabel = "查看说明",
}: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openTip() {
    clearCloseTimer();
    setOpen(true);
  }

  function closeTipWithDelay() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 280);
  }

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      clearCloseTimer();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function adjustPosition() {
      const triggerEl = triggerRef.current;
      const popEl = popRef.current;
      if (!triggerEl || !popEl) return;

      const triggerRect = triggerEl.getBoundingClientRect();
      const popupWidth = popEl.offsetWidth || 260;
      const popupHeight = popEl.offsetHeight || 40;
      const edge = 10;
      const gap = 12;

      const spaceRight = window.innerWidth - triggerRect.right - gap - edge;
      const spaceLeft = triggerRect.left - gap - edge;
      const showOnRight = spaceRight >= popupWidth || spaceRight >= spaceLeft;

      let left = showOnRight
        ? triggerRect.right + gap
        : triggerRect.left - gap - popupWidth;
      left = Math.max(edge, Math.min(left, window.innerWidth - edge - popupWidth));

      let top = triggerRect.top + triggerRect.height / 2 - popupHeight / 2;
      top = Math.max(edge, Math.min(top, window.innerHeight - edge - popupHeight));

      setPosition((prev) => {
        if (Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5) {
          return prev;
        }
        return { left, top };
      });
    }

    const id = window.requestAnimationFrame(adjustPosition);
    window.addEventListener("resize", adjustPosition);
    window.addEventListener("scroll", adjustPosition, true);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", adjustPosition);
      window.removeEventListener("scroll", adjustPosition, true);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={openTip}
      onMouseLeave={closeTipWithDelay}
      onFocus={openTip}
      onBlur={closeTipWithDelay}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openTip();
        }}
        className={
          variant === "text"
            ? "text-xs font-semibold text-[#003689] underline decoration-[#003689]/35 underline-offset-4"
            : "inline-flex h-[14px] w-[14px] min-h-[14px] min-w-[14px] shrink-0 items-center justify-center rounded-full border border-[#003689]/45 bg-white p-0 text-[8px] font-bold leading-none text-[#003689] shadow-[0_1px_2px_rgba(15,23,42,0.15)]"
        }
        style={variant === "icon" ? { borderRadius: "9999px", lineHeight: 1, aspectRatio: "1 / 1" } : undefined}
      >
        {variant === "text" ? triggerLabel : "?"}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              className="fixed z-[90] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs leading-5 text-slate-800 shadow-[0_14px_30px_rgba(15,23,42,0.18)]"
              style={{
                width: "min(260px, calc(100vw - 20px))",
                left: `${position.left}px`,
                top: `${position.top}px`,
                wordBreak: "break-word",
                whiteSpace: "normal",
                fontSize: "12px",
                fontWeight: 500,
                backgroundColor: "rgba(248, 250, 252, 0.98)",
              }}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
