import { HelpTip } from "@/src/components/ui/help-tip";

type MetricCardProps = {
  title: string;
  value: string;
  unit?: string;
  hint?: string;
  helpText?: string;
  helpTriggerLabel?: string;
  compact?: boolean;
  className?: string;
};

export function MetricCard({
  title,
  value,
  unit,
  hint,
  helpText,
  helpTriggerLabel,
  compact = false,
  className = "",
}: MetricCardProps) {
  return (
    <article
      className={`rounded-2xl border border-slate-200 bg-white shadow-[0_16px_38px_rgba(15,23,42,0.08)] ${
        compact ? "p-3" : "p-4"
      } ${className}`}
    >
      <div className={`flex ${compact ? "items-center justify-between gap-3" : "flex-col"}`}>
        <div className="flex items-center gap-2 text-xs text-slate-500 sm:text-sm">
          <span>{title}</span>
          {helpText ? (
            <HelpTip
              text={helpText}
              variant={helpTriggerLabel ? "text" : "icon"}
              triggerLabel={helpTriggerLabel}
            />
          ) : null}
        </div>
        <div
          className={`font-black text-slate-900 ${compact ? "whitespace-nowrap text-base sm:text-lg" : "mt-2 text-lg sm:text-xl lg:text-2xl"}`}
        >
          {value}
          {unit ? <span className="ml-1 text-xs font-normal text-slate-400">{unit}</span> : null}
        </div>
      </div>
      {hint ? <div className="mt-1.5 text-[11px] text-slate-600 sm:text-xs">{hint}</div> : null}
    </article>
  );
}
