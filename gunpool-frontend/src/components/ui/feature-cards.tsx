type FeatureItem = {
  title: string;
  description: string;
  tag?: string;
};

type FeatureCardsProps = {
  id?: string;
  title: string;
  subtitle?: string;
  items: FeatureItem[];
};

export function FeatureCards({ id, title, subtitle, items }: FeatureCardsProps) {
  return (
    <section id={id} className="mx-auto mt-10 w-full max-w-6xl px-4 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h2 className="text-2xl font-black text-white sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm text-slate-300 sm:text-base">{subtitle}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_45px_rgba(0,0,0,0.3)]"
          >
            {item.tag ? (
              <span className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-1 text-xs font-bold text-emerald-100">
                {item.tag}
              </span>
            ) : null}
            <h3 className="mt-3 text-lg font-bold text-white">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
