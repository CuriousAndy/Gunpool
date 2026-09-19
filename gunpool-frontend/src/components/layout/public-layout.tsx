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

type NavItem = {
  href: string;
  label: string;
};

type PublicLayoutProps = {
  children: ReactNode;
  navItems?: NavItem[];
  sideItems?: SideNavItem[];
  ctaHref?: string;
  ctaLabel?: string;
  minimal?: boolean;
};

const DEFAULT_TOP_ITEMS: NavItem[] = [
  { href: "/wallet", label: "登录页" },
  { href: "/console", label: "控制台" },
  { href: "/principle", label: "调仓决策" },
  { href: "/history", label: "调仓分析" },
  { href: "/strategy", label: "策略对比" },
  { href: "/analysis", label: "系统评估" },
  { href: "/help", label: "帮助" },
];

const DEFAULT_SIDE_ITEMS: SideNavItem[] = [
  { href: "/wallet", label: "登录页", hint: "演示钱包登录入口" },
  { href: "/console", label: "控制台", hint: "链上状态与资金操作" },
  { href: "/principle", label: "调仓决策", hint: "可视化调仓逻辑与决策依据" },
  { href: "/history", label: "调仓分析", hint: "调仓记录与图表追溯" },
  {
    href: "/strategy",
    label: "策略对比",
    hint: "频率/算法/窗口实验",
  },
  { href: "/strategy?section=params", label: "参数测试", hint: "本金、手续费与 Gas 假设" },
  { href: "/analysis", label: "系统评估", hint: "优缺点与局限性" },
  { href: "/help", label: "帮助", hint: "术语、规则与使用说明" },
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

function PublicTopNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const searchParams = useSearchParams();

  return (
    <nav className="flex items-center gap-6 pr-5">
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

export function PublicLayout({
  children,
  navItems = DEFAULT_TOP_ITEMS,
  sideItems = DEFAULT_SIDE_ITEMS,
  ctaHref = "/wallet",
  ctaLabel = "连接钱包",
  minimal = false,
}: PublicLayoutProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEChartsPreload();

  if (minimal) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
        <main className="w-full">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_15%_0%,#eef4ff_0,#f8fafc_38%,#f3f6fb_100%)] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/90 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-900 text-sm font-black">
              GP
            </span>
            <span className="text-sm font-black tracking-[0.04em] sm:text-base">GunPool</span>
            <NavClock />
          </Link>

          <div className="hidden h-16 items-stretch lg:flex">
            <Suspense fallback={<nav className="flex items-center gap-6 pr-5" aria-hidden="true" />}>
              <PublicTopNav items={navItems} pathname={pathname} />
            </Suspense>

            <Link
              href={ctaHref}
              className="inline-flex h-[calc(100%+1px)] -mb-px items-center bg-[#003689] px-7 text-sm font-bold !text-white transition hover:bg-[#002f79] visited:!text-white"
            >
              {ctaLabel}
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen((prev) => !prev)}
            className="inline-flex items-center p-2 text-slate-900 lg:hidden"
            aria-label="打开菜单"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {drawerOpen ? (
          <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
            <div className="mx-auto grid max-w-[1400px] gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={<aside className="hidden w-64 shrink-0 lg:block" aria-hidden="true" />}>
          <SideNav title="快速定位" items={sideItems} />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto w-full max-w-[1400px] px-4 text-sm text-slate-600 sm:px-6 lg:px-8">
          <div className="font-semibold text-slate-900">自动化收益聚合资金池系统</div>
          <div className="mt-1">用于毕业设计答辩展示，包含控制台、调仓分析、参数对比与局限性评估模块。</div>
        </div>
      </footer>
    </div>
  );
}
