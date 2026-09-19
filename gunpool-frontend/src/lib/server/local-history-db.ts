import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_DIR, "../../../");
const DB_DIR = path.join(FRONTEND_ROOT, ".local");
const DB_PATH = path.join(DB_DIR, "local-history.sqlite");

export type PersistedHistoryRowInput = {
  id: string;
  blockNumber: string;
  logIndex: number;
  blockTimeMs: number;
  txHash: string;
  eventType: "Rebalanced" | "PoolAPYUpdated" | "ActivePoolUpdated" | "Deposit" | "Withdraw";
  summary: string;
  detail: string;
};

export type PersistedAssetSnapshotInput = {
  t: number;
  vaultAssets: number;
};

export type PersistedHistoryRow = PersistedHistoryRowInput;

export type PersistedAssetSnapshot = PersistedAssetSnapshotInput;

let cachedDb: Database.Database | null = null;

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_history_rows (
      id TEXT PRIMARY KEY,
      user_address TEXT NOT NULL,
      block_number TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_time_ms INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_history_rows_user_time
    ON local_history_rows(user_address, block_time_ms DESC);

    CREATE TABLE IF NOT EXISTS local_asset_snapshots (
      user_address TEXT NOT NULL,
      t_ms INTEGER NOT NULL,
      vault_assets REAL NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (user_address, t_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_local_asset_snapshots_user_time
    ON local_asset_snapshots(user_address, t_ms DESC);
  `);
}

function getDb(): Database.Database {
  if (cachedDb) return cachedDb;

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  ensureSchema(db);
  cachedDb = db;
  return db;
}

export function upsertLocalHistory(
  userAddress: string,
  rows: PersistedHistoryRowInput[],
  snapshots: PersistedAssetSnapshotInput[]
) {
  const db = getDb();
  const now = Date.now();
  const normalizedAddress = normalizeAddress(userAddress);

  const rowStmt = db.prepare(`
    INSERT INTO local_history_rows(
      id, user_address, block_number, log_index, block_time_ms,
      tx_hash, event_type, summary, detail, created_at_ms
    )
    VALUES(
      @id, @userAddress, @blockNumber, @logIndex, @blockTimeMs,
      @txHash, @eventType, @summary, @detail, @createdAtMs
    )
    ON CONFLICT(id) DO NOTHING
  `);

  const snapshotStmt = db.prepare(`
    INSERT INTO local_asset_snapshots(user_address, t_ms, vault_assets, created_at_ms)
    VALUES(@userAddress, @tMs, @vaultAssets, @createdAtMs)
    ON CONFLICT(user_address, t_ms) DO NOTHING
  `);

  const tx = db.transaction(() => {
    for (const row of rows) {
      rowStmt.run({
        id: row.id,
        userAddress: normalizedAddress,
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        blockTimeMs: row.blockTimeMs,
        txHash: row.txHash,
        eventType: row.eventType,
        summary: row.summary,
        detail: row.detail,
        createdAtMs: now,
      });
    }

    for (const snapshot of snapshots) {
      snapshotStmt.run({
        userAddress: normalizedAddress,
        tMs: snapshot.t,
        vaultAssets: snapshot.vaultAssets,
        createdAtMs: now,
      });
    }
  });

  tx();
}

export function readLocalHistory(
  userAddress: string,
  limitRows = 2000,
  limitSnapshots = 5000
): {
  rows: PersistedHistoryRow[];
  snapshots: PersistedAssetSnapshot[];
} {
  const db = getDb();
  const normalizedAddress = normalizeAddress(userAddress);

  const rows = db
    .prepare(
      `
      SELECT id, block_number, log_index, block_time_ms, tx_hash, event_type, summary, detail
      FROM local_history_rows
      WHERE user_address = ?
      ORDER BY block_time_ms DESC, log_index DESC
      LIMIT ?
    `
    )
    .all(normalizedAddress, limitRows) as Array<{
    id: string;
    block_number: string;
    log_index: number;
    block_time_ms: number;
    tx_hash: string;
    event_type: PersistedHistoryRow["eventType"];
    summary: string;
    detail: string;
  }>;

  const snapshots = db
    .prepare(
      `
      SELECT t_ms, vault_assets
      FROM local_asset_snapshots
      WHERE user_address = ?
      ORDER BY t_ms ASC
      LIMIT ?
    `
    )
    .all(normalizedAddress, limitSnapshots) as Array<{
    t_ms: number;
    vault_assets: number;
  }>;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      blockNumber: row.block_number,
      logIndex: Number(row.log_index),
      blockTimeMs: Number(row.block_time_ms),
      txHash: row.tx_hash,
      eventType: row.event_type,
      summary: row.summary,
      detail: row.detail,
    })),
    snapshots: snapshots.map((item) => ({
      t: Number(item.t_ms),
      vaultAssets: Number(item.vault_assets),
    })),
  };
}
