import { NextResponse } from "next/server";

import { MARKET_APY_START_MS } from "../../../src/lib/market-pools";
import {
  getMarketDbPath,
  readLatestFetchRunItems,
  readLastFetchRunSummary,
  readStoredMarketSnapshot,
} from "../../../src/lib/server/market-db";
import { getSyncRuntimeConfig, syncMarketData } from "../../../src/lib/server/market-sync";

export const runtime = "nodejs";

type RouteQuery = {
  forceSync: boolean;
  decisionLimit: number;
};

function parseQuery(request: Request): RouteQuery {
  const url = new URL(request.url);
  const forceFlag = url.searchParams.get("forceSync") ?? url.searchParams.get("sync");
  const decisionLimitRaw = Number(url.searchParams.get("decisionLimit") ?? 720);

  return {
    forceSync: forceFlag === "1" || forceFlag === "true",
    decisionLimit: Number.isFinite(decisionLimitRaw)
      ? Math.max(24, Math.min(Math.floor(decisionLimitRaw), 24 * 365 * 5))
      : 720,
  };
}

export async function GET(request: Request) {
  const query = parseQuery(request);

  try {
    const syncResult = await syncMarketData({
      force: query.forceSync,
    });

    const snapshot = readStoredMarketSnapshot(query.decisionLimit);
    const lastRun = readLastFetchRunSummary();
    const runItems = readLatestFetchRunItems(20);
    const runtimeConfig = getSyncRuntimeConfig();

    return NextResponse.json({
      ok: true,
      startMs: snapshot.startMs,
      endMs: Math.max(snapshot.endMs, MARKET_APY_START_MS),
      updatedAt: snapshot.updatedAt,
      pools: snapshot.pools,
      decisions: snapshot.decisions,
      sync: syncResult,
      lastRun,
      fetchRunItems: runItems,
      systemProfile: {
        ...runtimeConfig,
        database: "SQLite + WAL",
        startDate: "2023-01-01",
        antiCrawler: "retry + backoff + user-agent rotation + concurrent workers",
      },
      dbPath: getMarketDbPath(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const syncResult = await syncMarketData({ force: true });
    const snapshot = readStoredMarketSnapshot(240);

    return NextResponse.json({
      ok: true,
      sync: syncResult,
      updatedAt: snapshot.updatedAt,
      pointsEndMs: snapshot.endMs,
      decisionCount: snapshot.decisions.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 }
    );
  }
}
