import Link from "next/link";

type Action = {
  href: string;
  label: string;
};

type HeroSectionProps = {
  badge?: string;
  titleLine1: string;
  titleLine2: string;
  description: string;
  primaryAction: Action;
};

export function HeroSection({
  badge,
  titleLine1,
  titleLine2,
  description,
  primaryAction,
}: HeroSectionProps) {
  return (
    <section className="relative min-h-[calc(100vh-64px)] w-full overflow-hidden">
      <div className="absolute inset-0">
        <div
          className="h-full w-full bg-[#020814] bg-contain bg-right bg-no-repeat"
          style={{ backgroundImage: "url('/hero-corporate.png')" }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-7xl items-center px-5 sm:px-8 lg:px-12">
        <div className="max-w-2xl text-white">
          {badge ? (
            <span className="inline-flex rounded-full border border-white/45 bg-white/10 px-3 py-1 text-xs font-bold tracking-[0.16em] text-white/95">
              {badge}
            </span>
          ) : null}

          <h1 className="mt-6 text-5xl font-black leading-[1.10] tracking-tight sm:text-6xl lg:text-7xl">
            {titleLine1}
            <br />
            {titleLine2}
          </h1>

          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-100 sm:text-base">{description}</p>

          <div className="mt-8">
            <Link
              href={primaryAction.href}
              className="inline-flex h-11 items-center justify-center rounded-md bg-[#003689] px-6 text-sm font-bold !text-white transition hover:bg-[#002f79] visited:!text-white"
            >
              {primaryAction.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
