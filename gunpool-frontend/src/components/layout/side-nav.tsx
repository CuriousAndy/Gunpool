"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export type SideNavItem = {
  href: string;
  label: string;
  hint?: string;
  children?: SideNavItem[];
};

type SideNavProps = {
  title?: string;
  items: SideNavItem[];
};

function parseHref(href: string): URL {
  return new URL(href, "http://localhost");
}

function isItemActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  if (href.startsWith("/#")) {
    return pathname === "/";
  }
  const parsed = parseHref(href);
  const basePath = parsed.pathname;
  if (basePath === "/") {
    return pathname === "/";
  }
  if (!pathname.startsWith(basePath)) return false;

  const expectedEntries = [...parsed.searchParams.entries()];
  if (basePath === "/strategy" && expectedEntries.length === 0 && searchParams.get("section") === "params") {
    return false;
  }
  if (expectedEntries.length === 0) return true;

  return expectedEntries.every(([key, value]) => searchParams.get(key) === value);
}

function strategyChildKind(href: string): "params" | "hold" | "frequency" | "algorithm" | "window" | "default" {
  const section = parseHref(href).searchParams.get("section");
  if (
    section === "params" ||
    section === "hold" ||
    section === "frequency" ||
    section === "algorithm" ||
    section === "window"
  ) {
    return section;
  }
  return "default";
}

function PanelIcon({
  kind,
  className = "h-4 w-4",
}: {
  kind: "params" | "hold" | "frequency" | "algorithm" | "window" | "default";
  className?: string;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const icons: Record<typeof kind, ReactNode> = {
    params: (
      <>
        <path {...common} d="M3.5 6.5h5M3.5 10h8M3.5 13.5h5" />
        <circle cx="11.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="11.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
      </>
    ),
    hold: (
      <>
        <path {...common} d="M10 4.2v11.6" />
        <path {...common} d="M4.2 10h11.6" />
      </>
    ),
    frequency: (
      <>
        <path {...common} d="M4.5 14.5V10" />
        <path {...common} d="M8.5 14.5V7.5" />
        <path {...common} d="M12.5 14.5V5.5" />
        <path {...common} d="M16.5 14.5V9" />
      </>
    ),
    algorithm: (
      <>
        <circle {...common} cx="10" cy="10" r="2.2" />
        <path {...common} d="M10 4.2v1.7M10 14.1v1.7M4.2 10h1.7M14.1 10h1.7M6 6l1.2 1.2M12.8 12.8 14 14M14 6l-1.2 1.2M7.2 12.8 6 14" />
      </>
    ),
    window: (
      <>
        <path {...common} d="M3.8 13.5h12.4" />
        <path {...common} d="M4.5 10.8 7.6 8.6l2.3 1.7 3.6-3.5 1.9 1.3" />
      </>
    ),
    default: (
      <>
        <circle {...common} cx="10" cy="10" r="5.5" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      {icons[kind]}
    </svg>
  );
}

export function SideNav({ title = "模块导航", items }: SideNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <aside className="hidden w-64 shrink-0 lg:block">
      <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <nav className="grid gap-2" aria-label={title}>
          {items.map((item) => {
            const active = isItemActive(pathname, searchParams, item.href);
            const hasChildren = Boolean(item.children?.length);
            const showChildrenInside = hasChildren && active;
            const panelChildren = item.children ?? [];
            return (
              <div key={item.href} className="grid gap-1.5">
                {showChildrenInside ? (
                  <div className="grid gap-1.5">
                    <Link
                      href={item.href}
                      className="rounded-xl border border-[#003689]/25 bg-[#003689]/10 px-3 py-2 text-[#003689] transition"
                    >
                      <div className="text-sm font-semibold">{item.label}</div>
                      {item.hint ? <div className="mt-1 text-xs text-slate-500">{item.hint}</div> : null}
                    </Link>

                    <div className="bg-white px-3 pb-3.5 pt-2.5">
                      <div className="grid gap-4.5 pl-2">
                        {panelChildren.map((child) => {
                          const childKind = strategyChildKind(child.href);
                          const childActive = isItemActive(pathname, searchParams, child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={`group relative flex items-center justify-between gap-3 rounded-xl py-3 pl-5 pr-3 transition ${
                                childActive
                                  ? "bg-white/80 text-slate-900"
                                  : "text-slate-700 hover:bg-white/65 hover:text-slate-900"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${
                                  childActive ? "bg-[#2f80ff]" : "bg-[#2f80ff]/85"
                                }`}
                              />
                              <div className="min-w-0 flex-1 pl-1">
                                <div className="text-[11px] font-medium leading-5">{child.label}</div>
                                {child.hint ? <div className="mt-1 text-[11px] leading-4 text-slate-500">{child.hint}</div> : null}
                              </div>
                              <div className={`${childActive ? "text-slate-400" : "text-slate-300 group-hover:text-slate-400"}`}>
                                <PanelIcon kind={childKind} className="h-4 w-4" />
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={`rounded-xl border px-3 py-2 transition ${
                      active
                        ? "border-[#003689]/25 bg-[#003689]/10 text-[#003689]"
                        : "border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <div className="text-sm font-semibold">{item.label}</div>
                    {item.hint ? <div className="mt-1 text-xs text-slate-500">{item.hint}</div> : null}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
