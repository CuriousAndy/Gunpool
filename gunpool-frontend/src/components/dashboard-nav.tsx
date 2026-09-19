"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";

type DashboardNavProps = {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
};

const NAV_ITEMS = [
  { href: "/", label: "官网首页", desc: "项目介绍、能力说明与入口" },
  { href: "/console", label: "控制台", desc: "状态总览、存取操作、图表预览" },
  { href: "/apy", label: "实时年化", desc: "真实借贷池 APY 历史曲线与策略线" },
  { href: "/history", label: "调仓记录", desc: "链上事件与调仓决策过程" },
];

export function DashboardNav({ title, subtitle, rightSlot }: DashboardNavProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeLabel = useMemo(() => {
    const active = NAV_ITEMS.find((item) => item.href === pathname);
    return active?.label ?? "控制台";
  }, [pathname]);

  const styles: Record<string, CSSProperties> = {
    frame: {
      maxWidth: 1120,
      margin: "0 auto",
      display: "grid",
      gap: 12,
      position: "relative",
      zIndex: 20,
    },
    top: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      borderRadius: 18,
      border: "1px solid rgba(255,255,255,0.18)",
      background:
        "linear-gradient(120deg, rgba(14,24,56,0.92), rgba(9,17,40,0.86)), radial-gradient(460px 220px at 10% 0%, rgba(122,214,255,0.2), transparent 65%)",
      padding: "14px 16px",
      boxShadow: "0 16px 42px rgba(0,0,0,0.38)",
    },
    brandBlock: {
      display: "grid",
      gap: 4,
      minWidth: 0,
      flex: 1,
    },
    brandTop: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      minWidth: 0,
    },
    brandDot: {
      width: 10,
      height: 10,
      borderRadius: 999,
      background: "#67D4FF",
      boxShadow: "0 0 12px rgba(103,212,255,0.9)",
      flexShrink: 0,
    },
    title: {
      fontSize: 24,
      fontWeight: 900,
      letterSpacing: 0.2,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    subtitle: {
      fontSize: 13,
      color: "rgba(234,240,255,0.74)",
      lineHeight: 1.5,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    topRight: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexShrink: 0,
    },
    menuBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.22)",
      background: "rgba(255,255,255,0.07)",
      color: "#ECF3FF",
      padding: "8px 12px",
      fontSize: 13,
      fontWeight: 800,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    quickNav: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(4,10,24,0.44)",
      padding: "8px",
    },
    quickItem: {
      textDecoration: "none",
      color: "rgba(226,236,255,0.88)",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.03)",
      padding: "8px 12px",
      fontSize: 13,
      fontWeight: 700,
    },
    quickItemActive: {
      background: "linear-gradient(90deg, rgba(75,145,255,0.52), rgba(43,203,255,0.34))",
      border: "1px solid rgba(255,255,255,0.32)",
      color: "#F4F8FF",
      boxShadow: "0 10px 18px rgba(0,0,0,0.26)",
    },
    panel: {
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.16)",
      background:
        "linear-gradient(130deg, rgba(7,15,35,0.96), rgba(9,20,48,0.9)), radial-gradient(360px 180px at 0% 0%, rgba(77,150,255,0.2), transparent 70%)",
      padding: 14,
      boxShadow: "0 20px 52px rgba(0,0,0,0.45)",
      display: menuOpen ? "grid" : "none",
      gap: 14,
    },
    panelTitle: {
      fontSize: 13,
      fontWeight: 900,
      color: "rgba(236,244,255,0.92)",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    panelGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 10,
    },
    panelLink: {
      textDecoration: "none",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.04)",
      padding: "10px 12px",
      color: "rgba(234,240,255,0.92)",
      display: "grid",
      gap: 4,
    },
    panelLinkActive: {
      border: "1px solid rgba(117,193,255,0.66)",
      background: "linear-gradient(90deg, rgba(57,134,255,0.3), rgba(35,203,255,0.18))",
    },
    panelLinkTitle: {
      fontSize: 14,
      fontWeight: 900,
    },
    panelLinkDesc: {
      fontSize: 12,
      lineHeight: 1.5,
      color: "rgba(234,240,255,0.72)",
    },
    chips: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
    },
    chip: {
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.05)",
      color: "rgba(234,240,255,0.84)",
      padding: "5px 10px",
      fontSize: 12,
      fontWeight: 700,
    },
  };

  return (
    <div style={styles.frame}>
      <div style={styles.top}>
        <div style={styles.brandBlock}>
          <div style={styles.brandTop}>
            <span style={styles.brandDot} />
            <div style={styles.title}>{title}</div>
          </div>
          <div style={styles.subtitle}>{subtitle || `当前页面：${activeLabel}`}</div>
        </div>

        <div style={styles.topRight}>
          {rightSlot}
          <button style={styles.menuBtn} onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? "收起导航" : "打开导航"}
          </button>
        </div>
      </div>

      <div style={styles.quickNav}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              ...styles.quickItem,
              ...(pathname === item.href ? styles.quickItemActive : null),
            }}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div style={styles.panel}>
        <div>
          <div style={styles.panelTitle}>{"页面导航"}</div>
          <div style={{ ...styles.panelGrid, marginTop: 8 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...styles.panelLink,
                  ...(pathname === item.href ? styles.panelLinkActive : null),
                }}
                onClick={() => setMenuOpen(false)}
              >
                <span style={styles.panelLinkTitle}>{item.label}</span>
                <span style={styles.panelLinkDesc}>{item.desc}</span>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <div style={styles.panelTitle}>{"术语提示"}</div>
          <div style={{ ...styles.chips, marginTop: 8 }}>
            <span style={styles.chip}>{"APY = 年化收益率"}</span>
            <span style={styles.chip}>{"调仓 = 资金从 A 池切换到 B 池"}</span>
            <span style={styles.chip}>{"预期增益 vs 手续费 决策"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
