type StatusTone = "neutral" | "ok" | "warn" | "error";

type StatusItem = {
  label: string;
  value: string;
  tone?: StatusTone;
};

type StatusBarProps = {
  items: StatusItem[];
};

function toneClass(tone: StatusTone): string {
  switch (tone) {
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function StatusBar({ items }: StatusBarProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_38px_rgba(15,23,42,0.08)]">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className={`rounded-xl border px-4 py-3 ${toneClass(item.tone ?? "neutral")}`}
          >
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-1 text-sm font-bold">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
