"use client";

import dynamic from "next/dynamic";
import { type CSSProperties, type ComponentType, useCallback, useEffect, useMemo, useState } from "react";

import { ConsoleLayout } from "@/src/components/layout/console-layout";
import { MARKET_APY_START_TEXT } from "../../src/lib/market-pools";
import type {
  FetchRunItemPayload,
  MarketApyApiPayload,
  MarketPoolPayload,
  RebalanceDecisionPayload,
  SystemProfilePayload,
} from "../../src/lib/market-api-types";

type EChartsProps = Record<string, unknown>;

type ZoomRange = {
  start: number;
  end: number;
};

type AxisMeta = {
  yMin: number;
  yMax: number;
  yInterval: number;
};

const ReactECharts = dynamic(
  async () => {
    const mod = (await import("echarts-for-react")) as {
      default: { default?: ComponentType<EChartsProps> } | ComponentType<EChartsProps>;
    };
    return typeof mod.default === "function" ? mod.default : mod.default.default!;
  },
  { ssr: false }
);

const POLL_MS = 60_000;
const STRATEGY_COLOR = "#FFD21F";
const PRIMARY_COLOR = "#003689";
const PRIMARY_HOVER_COLOR = "#002f79";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function pad2(v: number): string {
  return String(v).padStart(2, "0");
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtHourAxis(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}\n${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const safe = Math.floor(seconds);
  if (safe % 86_400 === 0) return `${safe / 86_400} 天`;
  if (safe % 3_600 === 0) return `${safe / 3_600} 小时`;
  if (safe % 60 === 0) return `${safe / 60} 分钟`;
  return `${safe} 秒`;
}

type ChartData = {
  selectedPools: MarketPoolPayload[];
  poolSeries: Array<Array<[number, number]>>;
  strategyValues: Array<[number, number]>;
  pointsCount: number;
};

function pickApyAxisStep(yMin: number, yMax: number): number {
  const span = Math.max(0.2, yMax - yMin);
  const targetTicks = 5;
  const raw = span / targetTicks;
  const steps = [0.2, 0.5, 1, 2, 5, 10, 20, 50];
  for (const step of steps) {
    if (step >= raw) return step;
  }
  return 100;
}

function buildAxisMetaFromValues(values: number[]): AxisMeta {
  if (values.length === 0) {
    return { yMin: 0, yMax: 10, yInterval: 2 };
  }

  let yMin = Math.floor((Math.min(...values) - 0.2) * 2) / 2;
  let yMax = Math.ceil((Math.max(...values) + 0.2) * 2) / 2;
  if (yMax - yMin < 1) {
    const mid = (yMin + yMax) / 2;
    yMin = Math.floor((mid - 0.6) * 2) / 2;
    yMax = Math.ceil((mid + 0.6) * 2) / 2;
  }

  return {
    yMin: Number(yMin.toFixed(2)),
    yMax: Number(yMax.toFixed(2)),
    yInterval: pickApyAxisStep(yMin, yMax),
  };
}

function buildChartData(
  pools: MarketPoolPayload[],
  selectedIds: Set<string>,
  endMs: number
): ChartData {
  const selectedPools = pools.filter((pool) => selectedIds.has(pool.id) && pool.points.length > 0);

  const poolSeries = selectedPools.map((pool) =>
    pool.points
      .filter((point) => point.t <= endMs)
      .map((point) => [point.t, Number(point.apy.toFixed(4))] as [number, number])
  );

  const timeline = Array.from(
    new Set(poolSeries.flat().map((point) => point[0]).sort((a, b) => a - b))
  );

  const strategyValues: Array<[number, number]> = [];
  for (const t of timeline) {
    let best = 0;
    for (const series of poolSeries) {
      let latest = series[0]?.[1] ?? 0;
      for (let i = 0; i < series.length; i++) {
        if (series[i][0] <= t) latest = series[i][1];
        else break;
      }
      if (latest > best) best = latest;
    }
    strategyValues.push([t, Number(best.toFixed(4))]);
  }

  return {
    selectedPools,
    poolSeries,
    strategyValues,
    pointsCount: timeline.length,
  };
}

function getAxisMetaForZoom(
  chartData: ChartData,
  showStrategyLine: boolean,
  zoomRange: ZoomRange
): AxisMeta {
  const allPoints = chartData.poolSeries.flat().concat(showStrategyLine ? chartData.strategyValues : []);
  if (allPoints.length === 0) {
    return buildAxisMetaFromValues([]);
  }

  let minT = allPoints[0][0];
  let maxT = allPoints[0][0];
  for (const [t] of allPoints) {
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  const start = clampPercent(zoomRange.start);
  const end = clampPercent(zoomRange.end);
  const from = Math.min(start, end);
  const to = Math.max(start, end);

  const tSpan = Math.max(1, maxT - minT);
  const visibleStart = minT + (tSpan * from) / 100;
  const visibleEnd = minT + (tSpan * to) / 100;

  const visibleValues = allPoints
    .filter(([t]) => t >= visibleStart && t <= visibleEnd)
    .map(([, v]) => v);

  const values = visibleValues.length > 0 ? visibleValues : allPoints.map(([, v]) => v);
  return buildAxisMetaFromValues(values);
}

function profileLine(profile: SystemProfilePayload | undefined, key: keyof SystemProfilePayload): string {
  if (!profile) return "--";
  return String(profile[key]);
}

export default function ApyPage() {
  const [payload, setPayload] = useState<MarketApyApiPayload | null>(null);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>([]);
  const [showStrategyLine, setShowStrategyLine] = useState(true);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange>({ start: 0, end: 100 });

  const fetchMarketData = useCallback(async (forceSync = false) => {
    try {
      const query = forceSync ? "?forceSync=1" : "";
      const res = await fetch(`/api/market-apy${query}`, { cache: "no-store" });
      const nextPayload = (await res.json()) as MarketApyApiPayload;
      if (!res.ok || !nextPayload.ok) {
        throw new Error(nextPayload.message || `请求失败: ${res.status}`);
      }

      setPayload(nextPayload);
      setSyncNotice(nextPayload.sync?.message || "");
      setError("");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "读取市场 APY 失败"));
    }
  }, []);

  useEffect(() => {
    void fetchMarketData();
    const id = window.setInterval(() => {
      void fetchMarketData();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchMarketData]);

  useEffect(() => {
    if (!payload) return;
    if (selectedPoolIds.length === 0) {
      setSelectedPoolIds(payload.pools.slice(0, 4).map((pool) => pool.id));
      return;
    }

    const allIds = new Set(payload.pools.map((pool) => pool.id));
    setSelectedPoolIds((prev) => prev.filter((id) => allIds.has(id)));
  }, [payload, selectedPoolIds.length]);

  const selectedIdSet = useMemo(() => new Set(selectedPoolIds), [selectedPoolIds]);

  const chartData = useMemo(() => {
    if (!payload) {
      return {
        selectedPools: [] as MarketPoolPayload[],
        poolSeries: [] as Array<Array<[number, number]>>,
        strategyValues: [] as Array<[number, number]>,
        pointsCount: 0,
      };
    }
    return buildChartData(payload.pools, selectedIdSet, payload.endMs || Date.now());
  }, [payload, selectedIdSet]);

  const axisMeta = useMemo(
    () => getAxisMetaForZoom(chartData, showStrategyLine, zoomRange),
    [chartData, showStrategyLine, zoomRange]
  );

  const onDataZoom = useCallback((event: unknown) => {
    const raw = event as {
      start?: number;
      end?: number;
      batch?: Array<{ start?: number; end?: number }>;
    };

    const batch = Array.isArray(raw.batch) && raw.batch.length > 0 ? raw.batch[0] : undefined;

    setZoomRange((prev) => {
      const nextStart = clampPercent(
        typeof batch?.start === "number"
          ? batch.start
          : typeof raw.start === "number"
          ? raw.start
          : prev.start
      );
      const nextEnd = clampPercent(
        typeof batch?.end === "number"
          ? batch.end
          : typeof raw.end === "number"
          ? raw.end
          : prev.end
      );

      const normalized: ZoomRange = {
        start: Math.min(nextStart, nextEnd),
        end: Math.max(nextStart, nextEnd),
      };

      if (
        Math.abs(normalized.start - prev.start) < 0.01 &&
        Math.abs(normalized.end - prev.end) < 0.01
      ) {
        return prev;
      }

      return normalized;
    });
  }, []);

  const chartEvents = useMemo(
    () => ({
      datazoom: onDataZoom,
    }),
    [onDataZoom]
  );

  const option = useMemo<Record<string, unknown>>(() => {
    const series: Array<Record<string, unknown>> = chartData.poolSeries.map((data, i) => ({
      name: chartData.selectedPools[i]?.name ?? `池子 ${i + 1}`,
      type: "line",
      smooth: true,
      showSymbol: false,
      data,
      lineStyle: {
        width: 2.2,
        color: chartData.selectedPools[i]?.color || "#8FA5D9",
        opacity: 0.92,
      },
      itemStyle: {
        color: chartData.selectedPools[i]?.color || "#8FA5D9",
      },
      z: 4,
    }));

    if (showStrategyLine) {
      series.push({
        name: "策略线（虚线，按当前可见协议取最高）",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: chartData.strategyValues,
        lineStyle: {
          type: "dashed",
          width: 4.6,
          color: STRATEGY_COLOR,
          opacity: 0.95,
          shadowColor: "rgba(255,210,31,0.35)",
          shadowBlur: 8,
        },
        itemStyle: { color: STRATEGY_COLOR },
        emphasis: {
          lineStyle: { width: 5.2 },
        },
        z: 10,
      });
    }

    return {
      backgroundColor: "transparent",
      color: [...chartData.selectedPools.map((p) => p.color), ...(showStrategyLine ? [STRATEGY_COLOR] : [])],
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { color: "rgba(148, 163, 184, 0.65)" },
        },
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        borderColor: "rgba(148, 163, 184, 0.4)",
        textStyle: { color: "#0f172a" },
        formatter: (params: unknown) => {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            value?: [number, number];
            axisValue?: number;
            marker: string;
            seriesName: string;
          }>;
          if (!rows.length) return "";
          const x = Number(rows[0].value?.[0] ?? rows[0].axisValue ?? 0);
          const lines = [fmtDateTime(x)];
          for (const row of rows) {
            const value = Number(row.value?.[1] ?? 0);
            lines.push(`${row.marker}${row.seriesName}: ${value.toFixed(2)}%`);
          }
          return lines.join("<br/>");
        },
      },
      legend: {
        top: 0,
        left: 0,
        icon: "circle",
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: "rgba(15,23,42,0.88)", fontSize: 13, fontWeight: 700 },
      },
      grid: { left: 56, right: 24, top: 54, bottom: 92 },
      xAxis: {
        type: "time",
        boundaryGap: false,
        axisLabel: {
          color: "rgba(71,85,105,0.9)",
          formatter: (value: number) => fmtHourAxis(value),
          margin: 10,
        },
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.45)" } },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.25)" } },
      },
      yAxis: {
        type: "value",
        min: axisMeta.yMin,
        max: axisMeta.yMax,
        interval: axisMeta.yInterval,
        splitNumber: 5,
        axisLabel: {
          color: "rgba(71,85,105,0.9)",
          formatter: (v: number) => (axisMeta.yInterval >= 1 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`),
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.25)" } },
      },
      dataZoom: [
        {
          type: "inside",
          throttle: 50,
          minSpan: 4,
          start: zoomRange.start,
          end: zoomRange.end,
        },
        {
          type: "slider",
          height: 30,
          bottom: 14,
          start: zoomRange.start,
          end: zoomRange.end,
          borderColor: "rgba(148,163,184,0.4)",
          backgroundColor: "rgba(140, 164, 217, 0.16)",
          fillerColor: "rgba(176, 198, 241, 0.36)",
          textStyle: { color: "rgba(71,85,105,0.85)" },
          dataBackground: {
            lineStyle: { color: "rgba(190, 210, 255, 0.66)" },
            areaStyle: { color: "rgba(120, 155, 230, 0.2)" },
          },
          handleStyle: {
            color: "#334155",
            borderColor: "rgba(180, 198, 239, 0.95)",
          },
        },
      ],
      series,
    };
  }, [axisMeta, chartData, showStrategyLine, zoomRange]);

  function togglePool(poolId: string) {
    setSelectedPoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(poolId)) {
        next.delete(poolId);
      } else {
        next.add(poolId);
      }
      return Array.from(next);
    });
  }

  const profile = payload?.systemProfile;
  const fetchRunItems = payload?.fetchRunItems ?? [];
  const latestDecision = useMemo<RebalanceDecisionPayload | null>(() => {
    const decisions = payload?.decisions ?? [];
    if (decisions.length === 0) return null;
    return decisions.reduce((latest, current) => (current.t > latest.t ? current : latest), decisions[0]);
  }, [payload]);

  const configuredWindowSeconds = useMemo(() => {
    const raw = Number(profile?.rebalanceWindowSeconds);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7 * 24 * 60 * 60;
  }, [profile?.rebalanceWindowSeconds]);
  const configuredFeeRateBps = useMemo(() => {
    const raw = Number(profile?.rebalanceFeeRateBps);
    return Number.isFinite(raw) && raw >= 0 ? raw : 5;
  }, [profile?.rebalanceFeeRateBps]);
  const configuredFeeMinUsdc = useMemo(() => {
    const raw = Number(profile?.rebalanceFeeMinUsdc ?? profile?.rebalanceFeeUsdc);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }, [profile?.rebalanceFeeMinUsdc, profile?.rebalanceFeeUsdc]);
  const latestWindowSeconds = latestDecision?.windowSeconds ?? configuredWindowSeconds;
  const latestFeeRateBps = useMemo(() => {
    if (!latestDecision || latestDecision.assetsBefore <= 0) return configuredFeeRateBps;
    return (latestDecision.rebalanceFee / latestDecision.assetsBefore) * 10_000;
  }, [latestDecision, configuredFeeRateBps]);
  const latestFeeExplain = useMemo(() => {
    if (!latestDecision) {
      return `手续费按百分比费率计算：rebalanceFee = max(minFee, assetsBefore × feeRateBps / 10000)。当前 minFee=${configuredFeeMinUsdc.toFixed(4)} mUSDC（设为 0 时即纯百分比）。`;
    }
    const feeByRate = latestDecision.assetsBefore * (configuredFeeRateBps / 10_000);
    if (feeByRate <= configuredFeeMinUsdc) {
      return `当前由最低手续费生效：按费率应为 ${feeByRate.toFixed(6)} mUSDC，低于 minFee ${configuredFeeMinUsdc.toFixed(4)} mUSDC。`;
    }
    return `当前由百分比费率生效：assetsBefore × feeRate = ${feeByRate.toFixed(6)} mUSDC（显示值按4位小数，视觉上可能接近固定）。`;
  }, [latestDecision, configuredFeeRateBps, configuredFeeMinUsdc]);

  const styles: Record<string, CSSProperties> = {
    shell: { display: "grid", gap: 14 },
    card: {
      padding: 18,
      borderRadius: 18,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "#ffffff",
      boxShadow: "0 16px 38px rgba(15,23,42,0.08)",
    },
    title: { fontSize: 18, fontWeight: 900, marginBottom: 8 },
    meta: {
      marginBottom: 10,
      color: "rgba(51,65,85,0.86)",
      fontSize: 14,
      lineHeight: 1.7,
    },
    controls: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8,
    },
    advancedPanel: {
      marginBottom: 12,
      padding: "12px 12px 10px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "rgba(248,250,252,0.9)",
    },
    check: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(148,163,184,0.45)",
      background: "rgba(248,250,252,0.9)",
      fontSize: 13,
      cursor: "pointer",
    },
    checkStrategy: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,210,31,0.46)",
      background: "rgba(255,210,31,0.12)",
      fontSize: 13,
      cursor: "pointer",
      fontWeight: 800,
      color: "#854d0e",
    },
    primaryButton: {
      padding: "6px 10px",
      borderRadius: 10,
      border: `1px solid ${PRIMARY_COLOR}`,
      background: PRIMARY_COLOR,
      color: "#ffffff",
      boxShadow: `inset 0 -1px 0 ${PRIMARY_HOVER_COLOR}`,
      fontWeight: 800,
      cursor: "pointer",
      fontSize: 12,
    },
    secondaryButton: {
      padding: "6px 10px",
      borderRadius: 10,
      border: `1px solid ${PRIMARY_COLOR}`,
      background: "rgba(0, 54, 137, 0.06)",
      color: PRIMARY_COLOR,
      fontWeight: 800,
      cursor: "pointer",
      fontSize: 12,
    },
    hint: {
      opacity: 0.82,
      fontSize: 13,
      lineHeight: 1.7,
    },
    error: {
      marginTop: 10,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(251,113,133,0.5)",
      background: "rgba(254,242,242,0.95)",
      color: "#b91c1c",
      fontSize: 13,
    },
    infoGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 10,
    },
    infoItem: {
      padding: "12px 14px",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.35)",
      background: "rgba(248,250,252,0.92)",
      fontSize: 13,
      lineHeight: 1.7,
    },
    tableWrap: {
      marginTop: 10,
      maxHeight: 220,
      overflow: "auto",
      borderRadius: 12,
      border: "1px solid rgba(148,163,184,0.35)",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 12,
    },
    th: {
      textAlign: "left",
      padding: "8px 10px",
      borderBottom: "1px solid rgba(148,163,184,0.35)",
      position: "sticky",
      top: 0,
      background: "rgba(248,250,252,0.98)",
      zIndex: 2,
    },
    td: {
      padding: "8px 10px",
      borderBottom: "1px solid rgba(148,163,184,0.25)",
    },
    detailsSummary: {
      cursor: "pointer",
      listStyle: "none",
      color: PRIMARY_COLOR,
      fontSize: 13,
      fontWeight: 800,
    },
  };

  return (
    <ConsoleLayout
      title="实时年化曲线"
      subtitle="数据库版本：真实借贷池历史 APY（2023-01-01 至今）"
      rightSlot={
        <button style={styles.primaryButton} onClick={() => void fetchMarketData(true)}>
          手动同步数据
        </button>
      }
    >
      <div style={styles.shell}>
        <div style={styles.card}>
          <div style={styles.title}>真实借贷池 APY 曲线</div>
          <div style={styles.meta}>
            起始时间：{payload ? fmtDateTime(payload.startMs) : MARKET_APY_START_TEXT}
            {"  ·  "}
            当前时间：{payload ? fmtDateTime(payload.updatedAt) : "--"}
            {"  ·  "}
            采样点：{chartData.pointsCount}
            {"  ·  "}
            当前纵轴：{axisMeta.yMin.toFixed(axisMeta.yInterval >= 1 ? 0 : 1)}% ~{" "}
            {axisMeta.yMax.toFixed(axisMeta.yInterval >= 1 ? 0 : 1)}%
          </div>

          <div style={styles.controls}>
            <button style={styles.secondaryButton} onClick={() => setZoomRange({ start: 0, end: 100 })}>
              重置缩放
            </button>
            <button style={styles.secondaryButton} onClick={() => setShowAdvancedControls((prev) => !prev)}>
              {showAdvancedControls ? "收起高级控制" : "展开高级控制"}
            </button>
          </div>

          {showAdvancedControls ? (
            <div style={styles.advancedPanel}>
              <div style={styles.controls}>
                <button
                  style={styles.secondaryButton}
                  onClick={() => setSelectedPoolIds(payload?.pools.map((pool) => pool.id) ?? [])}
                >
                  全选协议
                </button>
                <button style={styles.secondaryButton} onClick={() => setSelectedPoolIds([])}>
                  清空选择
                </button>
              </div>
              <div style={{ ...styles.controls, marginBottom: 0 }}>
                {(payload?.pools ?? []).map((pool) => (
                  <label key={pool.id} style={styles.check}>
                    <input
                      type="checkbox"
                      checked={selectedIdSet.has(pool.id)}
                      onChange={() => togglePool(pool.id)}
                    />
                    <span style={{ color: pool.color }}>{pool.name}</span>
                  </label>
                ))}
                <label style={styles.checkStrategy}>
                  <input
                    type="checkbox"
                    checked={showStrategyLine}
                    onChange={(e) => setShowStrategyLine(e.target.checked)}
                  />
                  <span>策略线显示</span>
                </label>
              </div>
            </div>
          ) : null}

          <ReactECharts
            option={option}
            style={{ height: 560, width: "100%" }}
            notMerge
            onEvents={chartEvents}
          />

          {error ? <div style={styles.error}>{error}</div> : null}
          {syncNotice ? <div style={styles.hint}>同步状态：{syncNotice}</div> : null}
          {payload?.sync?.failedPools?.length ? (
            <div style={styles.hint}>抓取失败池数量：{payload.sync.failedPools.length}（已保留数据库旧值）</div>
          ) : null}
        </div>

        <div style={styles.card}>
          <div style={styles.title}>读图说明</div>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              `APY` 表示年化收益率，值越高通常收益潜力越高。
              <br />
              “策略线”表示系统在当时可见协议里选择最高 APY 的理论轨迹。
            </div>
            <div style={styles.infoItem}>
              如果两条协议曲线很接近，系统不一定立即切换，
              <br />
              还要看“增益能否覆盖手续费”。当前窗口为 {fmtDuration(configuredWindowSeconds)}（{configuredWindowSeconds} 秒）。
            </div>
            <div style={styles.infoItem}>
              现在纵轴会跟随缩放窗口动态重算，
              <br />
              放大低利率区间时不会再挤成一团。
            </div>
          </div>
          <div style={{ ...styles.infoItem, marginTop: 10 }}>
            最近一次决策窗口：{fmtDuration(latestWindowSeconds)}（{latestWindowSeconds} 秒）；
            最近一次预期增益：{latestDecision ? `${latestDecision.expectedGain.toFixed(4)} mUSDC` : "--"}；
            手续费：{latestDecision ? `${latestDecision.rebalanceFee.toFixed(4)} mUSDC` : "--"}。
            <br />
            手续费模型：max({configuredFeeMinUsdc.toFixed(4)} mUSDC, 资产 × {configuredFeeRateBps.toFixed(2)} bps / 10000)。
            最近一次折算费率约 {latestFeeRateBps.toFixed(2)} bps。
            <br />
            {latestFeeExplain}
          </div>
        </div>

        <details style={styles.card}>
          <summary style={styles.detailsSummary}>展开高级参数与抓取状态</summary>
          <div style={{ marginTop: 10 }}>
            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                数据库：{profileLine(profile, "database")}
                <br />
                反爬策略：{profileLine(profile, "antiCrawler")}
                <br />
                抓取并发数：{profileLine(profile, "fetchConcurrency")}
                <br />
                抓取重试次数：{profileLine(profile, "fetchRetry")}
              </div>
              <div style={styles.infoItem}>
                调仓窗口（秒）：{profileLine(profile, "rebalanceWindowSeconds")}
                <br />
                手续费费率（bps）：{profileLine(profile, "rebalanceFeeRateBps")}
                <br />
                最低手续费（USDC）：{profileLine(profile, "rebalanceFeeMinUsdc")}
                <br />
                策略起始资产：{profileLine(profile, "strategyStartAssets")}
              </div>
            </div>

            {fetchRunItems.length > 0 ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>池子</th>
                      <th style={styles.th}>状态</th>
                      <th style={styles.th}>尝试次数</th>
                      <th style={styles.th}>HTTP</th>
                      <th style={styles.th}>点数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fetchRunItems.map((item: FetchRunItemPayload) => (
                      <tr key={item.poolId}>
                        <td style={styles.td}>{item.poolName}</td>
                        <td style={styles.td}>{item.status}</td>
                        <td style={styles.td}>{item.attempts}</td>
                        <td style={styles.td}>{item.httpStatus ?? "--"}</td>
                        <td style={styles.td}>{item.pointsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div style={styles.hint}>
              数据源：DefiLlama 历史 APY；数据先写入 SQLite，再由前端读取。策略线为强调型虚线，可通过“策略线显示”单独开关。
            </div>
          </div>
        </details>
      </div>
    </ConsoleLayout>
  );
}
