"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useEffect, useState } from "react";

// 预加载 ECharts 包，使策略/历史页面切换时图表立即可用
function useEChartsPreload() {
  useEffect(() => {
    void import("echarts-for-react");
  }, []);
}

function NavClock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      );
    }
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!time) return null;
  return <span className="ml-2 text-[11px] font-normal tabular-nums text-slate-400">{time}</span>;
}

import { SideNav, type SideNavItem } from "@/src/components/layout/side-nav";

type ConsoleLayoutProps = {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  children: ReactNode;
  hidePageHeader?: boolean;
};

type NavItem = {
  href: string;
  label: string;
};

const TOP_NAV: NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/console", label: "控制台" },
  { href: "/principle", label: "调仓决策" },
  { href: "/history", label: "调仓分析" },
  { href: "/strategy", label: "策略对比" },
  { href: "/analysis", label: "系统评估" },
  { href: "/help", label: "帮助" },
];

const SIDE_NAV: SideNavItem[] = [
  { href: "/", label: "首页", hint: "系统概览与演示导航" },
  { href: "/console", label: "控制台", hint: "钱包与链上交互" },
  { href: "/principle", label: "调仓决策", hint: "可视化调仓逻辑与决策依据" },
  { href: "/history", label: "调仓分析", hint: "真实调仓记录追溯" },
  {
    href: "/strategy",
    label: "策略对比",
    hint: "参数实验与算法比较",
  },
  { href: "/strategy?section=params", label: "参数测试", hint: "本金、手续费与 Gas 假设" },
  { href: "/analysis", label: "系统评估", hint: "优缺点与局限性" },
  { href: "/help", label: "帮助", hint: "规则、术语与读图说明" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname.startsWith(href);
}

function parseHref(href: string): URL {
  return new URL(href, "http://localhost");
}

function isNavActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  const parsed = parseHref(href);
  const basePath = parsed.pathname;
  if (basePath === "/") return pathname === "/";
  if (!isActive(pathname, basePath)) return false;

  const expectedEntries = [...parsed.searchParams.entries()];
  if (basePath === "/strategy" && expectedEntries.length === 0 && searchParams.get("section") === "params") {
    return false;
  }
  if (expectedEntries.length === 0) return true;
  return expectedEntries.every(([key, value]) => searchParams.get(key) === value);
}

function ConsoleTopNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const searchParams = useSearchParams();

  return (
    <nav className="hidden items-center gap-5 lg:flex">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`text-sm font-semibold transition ${
            isNavActive(pathname, searchParams, item.href) ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function ConsoleLayout({
  title,
  subtitle,
  rightSlot,
  children,
  hidePageHeader = false,
}: ConsoleLayoutProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEChartsPreload();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_0%,#eef4ff_0,#f8fafc_38%,#f3f6fb_100%)] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-900 text-sm font-black">
              GP
            </span>
            <span className="text-sm font-black tracking-[0.04em] sm:text-base">GunPool</span>
            <NavClock />
          </Link>

          <Suspense fallback={<nav className="hidden items-center gap-5 lg:flex" aria-hidden="true" />}>
            <ConsoleTopNav items={TOP_NAV} pathname={pathname} />
          </Suspense>

          <div className="hidden items-center gap-2 lg:flex">{rightSlot}</div>

          <button
            type="button"
            onClick={() => setDrawerOpen((prev) => !prev)}
            className="inline-flex items-center p-2 text-slate-900 lg:hidden"
            aria-label="打开导航"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {drawerOpen ? (
          <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
            <div className="mx-auto grid max-w-[1400px] gap-2">
              {TOP_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {item.label}
                </Link>
              ))}
              {rightSlot ? <div className="mt-2">{rightSlot}</div> : null}
            </div>
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={<aside className="hidden w-64 shrink-0 lg:block" aria-hidden="true" />}>
          <SideNav title="控制台导航" items={SIDE_NAV} />
        </Suspense>

        <main className="min-w-0 flex-1">
          {!hidePageHeader ? (
            <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.08)]">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-2 text-sm text-slate-600 sm:text-base">{subtitle}</p> : null}
            </section>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
