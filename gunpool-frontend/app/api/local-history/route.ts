import { NextResponse } from "next/server";

import {
  readLocalHistory,
  upsertLocalHistory,
  type PersistedAssetSnapshotInput,
  type PersistedHistoryRowInput,
} from "@/src/lib/server/local-history-db";

export const runtime = "nodejs";

const MAX_ROWS_PER_WRITE = 1000;
const MAX_SNAPSHOTS_PER_WRITE = 500;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRows(input: unknown): PersistedHistoryRowInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_ROWS_PER_WRITE)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const eventType = asString(row.eventType) as PersistedHistoryRowInput["eventType"];
      if (!eventType) return null;
      return {
        id: asString(row.id),
        blockNumber: asString(row.blockNumber),
        logIndex: Math.floor(asNumber(row.logIndex)),
        blockTimeMs: Math.floor(asNumber(row.blockTimeMs)),
        txHash: asString(row.txHash),
        eventType,
        summary: asString(row.summary),
        detail: asString(row.detail),
      };
    })
    .filter(
      (row): row is PersistedHistoryRowInput =>
        Boolean(
          row &&
            row.id &&
            row.blockNumber &&
            row.txHash &&
            row.eventType &&
            row.blockTimeMs > 0
        )
    );
}

function parseSnapshots(input: unknown): PersistedAssetSnapshotInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_SNAPSHOTS_PER_WRITE)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const snapshot = item as Record<string, unknown>;
      return {
        t: Math.floor(asNumber(snapshot.t)),
        vaultAssets: asNumber(snapshot.vaultAssets),
      };
    })
    .filter(
      (snapshot): snapshot is PersistedAssetSnapshotInput =>
        Boolean(snapshot && snapshot.t > 0 && Number.isFinite(snapshot.vaultAssets))
    );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const user = (url.searchParams.get("user") ?? "").trim().toLowerCase();
    const limitRowsRaw = Number(url.searchParams.get("limitRows") ?? 2000);
    const limitSnapshotsRaw = Number(url.searchParams.get("limitSnapshots") ?? 5000);
    const limitRows = Number.isFinite(limitRowsRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRowsRaw))) : 2000;
    const limitSnapshots = Number.isFinite(limitSnapshotsRaw)
      ? Math.max(1, Math.min(10000, Math.floor(limitSnapshotsRaw)))
      : 5000;

    if (!user) {
      return NextResponse.json({ ok: false, message: "missing user" }, { status: 400 });
    }

    const payload = readLocalHistory(user, limitRows, limitSnapshots);
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userAddress = asString(body.userAddress).trim().toLowerCase();
    if (!userAddress) {
      return NextResponse.json({ ok: false, message: "missing userAddress" }, { status: 400 });
    }

    const rows = parseRows(body.rows);
    const snapshots = parseSnapshots(body.snapshots);
    upsertLocalHistory(userAddress, rows, snapshots);

    return NextResponse.json({
      ok: true,
      insertedRows: rows.length,
      insertedSnapshots: snapshots.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

