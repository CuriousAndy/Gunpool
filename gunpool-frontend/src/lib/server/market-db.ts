import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { MARKET_APY_POOLS, MARKET_APY_START_MS, type MarketApyPool } from "../market-pools";

const DB_DIR = path.join(process.cwd(), ".local");
const DB_PATH = path.join(DB_DIR, "market-data.sqlite");

type RawPoolRow = {
  id: string;
  name: string;
  project: string;
  symbol: string;
  color: string;
};

type RawApyPoint = {
  t_ms: number;
  apy_pct: number;
};

type RawDecisionRow = {
  t_ms: number;
  active_pool_id: string;
  active_apy_pct: number;
  best_pool_id: string;
  best_apy_pct: number;
  delta_bps: number;
  assets_before: number;
  expected_gain: number;
  rebalance_fee: number;
  should_rebalance: number;
  reason: string;
  assets_after_fee: number;
  assets_after_growth: number;
  window_seconds: number;
  updated_at_ms: number;
};

type RawFetchRunItemRow = {
  pool_id: string;
  pool_name: string;
  attempts: number;
  http_status: number | null;
  status: "ok" | "error";
  points_count: number;
  message: string;
};

export type MarketPoint = {
  t: number;
  apy: number;
};

export type StoredPool = MarketApyPool & {
  points: MarketPoint[];
};

export type RebalanceDecision = {
  t: number;
  activePoolId: string;
  activePoolName: string;
  activeApy: number;
  bestPoolId: string;
  bestPoolName: string;
  bestApy: number;
  deltaBps: number;
  assetsBefore: number;
  expectedGain: number;
  rebalanceFee: number;
  shouldRebalance: boolean;
  reason: string;
  assetsAfterFee: number;
  assetsAfterGrowth: number;
  windowSeconds: number;
  updatedAt: number;
};

export type StoredMarketSnapshot = {
  startMs: number;
  endMs: number;
  updatedAt: number;
  pools: StoredPool[];
  decisions: RebalanceDecision[];
};

export type FetchRunItemSummary = {
  poolId: string;
  poolName: string;
  attempts: number;
  httpStatus: number | null;
  status: "ok" | "error";
  pointsCount: number;
  message: string;
};

export type FetchRunItemInput = {
  runId: number;
  poolId: string;
  attempts: number;
  httpStatus: number | null;
  status: "ok" | "error";
  pointsCount: number;
  message: string;
};

let cachedDb: Database.Database | null = null;

function getPoolNameMap(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare(
      `
      SELECT id, name
      FROM market_pools
      ORDER BY rowid ASC
    `
    )
    .all() as Array<{ id: string; name: string }>;

  return new Map(rows.map((row) => [row.id, row.name]));
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS market_pools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project TEXT NOT NULL,
      symbol TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_apy_points (
      pool_id TEXT NOT NULL,
      t_ms INTEGER NOT NULL,
      apy_pct REAL NOT NULL,
      source TEXT NOT NULL,
      fetched_at_ms INTEGER NOT NULL,
      PRIMARY KEY (pool_id, t_ms),
      FOREIGN KEY (pool_id) REFERENCES market_pools(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_market_apy_points_time
    ON market_apy_points(t_ms);

    CREATE TABLE IF NOT EXISTS market_fetch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER,
      status TEXT NOT NULL,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS market_fetch_run_items (
      run_id INTEGER NOT NULL,
      pool_id TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      http_status INTEGER,
      status TEXT NOT NULL,
      points_count INTEGER NOT NULL,
      message TEXT,
      PRIMARY KEY (run_id, pool_id),
      FOREIGN KEY (run_id) REFERENCES market_fetch_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (pool_id) REFERENCES market_pools(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rebalance_decisions (
      t_ms INTEGER PRIMARY KEY,
      active_pool_id TEXT NOT NULL,
      active_apy_pct REAL NOT NULL,
      best_pool_id TEXT NOT NULL,
      best_apy_pct REAL NOT NULL,
      delta_bps INTEGER NOT NULL,
      assets_before REAL NOT NULL,
      expected_gain REAL NOT NULL,
      rebalance_fee REAL NOT NULL,
      should_rebalance INTEGER NOT NULL,
      reason TEXT NOT NULL,
      assets_after_fee REAL NOT NULL,
      assets_after_growth REAL NOT NULL,
      window_seconds INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (active_pool_id) REFERENCES market_pools(id),
      FOREIGN KEY (best_pool_id) REFERENCES market_pools(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rebalance_decisions_time
    ON rebalance_decisions(t_ms DESC);
  `);
}

function seedPools(db: Database.Database) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO market_pools(id, name, project, symbol, color, created_at_ms, updated_at_ms)
    VALUES(@id, @name, @project, @symbol, @color, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      project=excluded.project,
      symbol=excluded.symbol,
      color=excluded.color,
      updated_at_ms=excluded.updated_at_ms
  `);

  const tx = db.transaction(() => {
    for (const pool of MARKET_APY_POOLS) {
      stmt.run({
        id: pool.id,
        name: pool.name,
        project: pool.project,
        symbol: pool.symbol,
        color: pool.color,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  tx();
}

export function getMarketDb(): Database.Database {
  if (cachedDb) {
    return cachedDb;
  }

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  ensureSchema(db);
  seedPools(db);
  cachedDb = db;
  return db;
}

export function getMarketDbPath(): string {
  return DB_PATH;
}

export function beginFetchRun(): number {
  const db = getMarketDb();
  const result = db
    .prepare(
      `
      INSERT INTO market_fetch_runs(started_at_ms, status)
      VALUES(?, ?)
    `
    )
    .run(Date.now(), "running");

  return Number(result.lastInsertRowid);
}

export function finishFetchRun(runId: number, status: "ok" | "error", message: string) {
  const db = getMarketDb();
  db.prepare(
    `
    UPDATE market_fetch_runs
    SET finished_at_ms = ?, status = ?, message = ?
    WHERE id = ?
  `
  ).run(Date.now(), status, message, runId);
}

export function upsertFetchRunItem(input: FetchRunItemInput) {
  const db = getMarketDb();
  db.prepare(
    `
    INSERT INTO market_fetch_run_items(
      run_id,
      pool_id,
      attempts,
      http_status,
      status,
      points_count,
      message
    )
    VALUES(@runId, @poolId, @attempts, @httpStatus, @status, @pointsCount, @message)
    ON CONFLICT(run_id, pool_id) DO UPDATE SET
      attempts=excluded.attempts,
      http_status=excluded.http_status,
      status=excluded.status,
      points_count=excluded.points_count,
      message=excluded.message
  `
  ).run({
    runId: input.runId,
    poolId: input.poolId,
    attempts: input.attempts,
    httpStatus: input.httpStatus,
    status: input.status,
    pointsCount: input.pointsCount,
    message: input.message,
  });
}

export function replacePoolPoints(
  poolId: string,
  points: MarketPoint[],
  source: string,
  fetchedAtMs: number
) {
  const db = getMarketDb();
  const removeStmt = db.prepare(
    `
    DELETE FROM market_apy_points
    WHERE pool_id = ? AND t_ms >= ?
  `
  );
  const insertStmt = db.prepare(
    `
    INSERT INTO market_apy_points(pool_id, t_ms, apy_pct, source, fetched_at_ms)
    VALUES(@poolId, @tMs, @apyPct, @source, @fetchedAtMs)
    ON CONFLICT(pool_id, t_ms) DO UPDATE SET
      apy_pct=excluded.apy_pct,
      source=excluded.source,
      fetched_at_ms=excluded.fetched_at_ms
  `
  );

  const tx = db.transaction(() => {
    removeStmt.run(poolId, MARKET_APY_START_MS);
    for (const point of points) {
      insertStmt.run({
        poolId,
        tMs: point.t,
        apyPct: point.apy,
        source,
        fetchedAtMs,
      });
    }
  });

  tx();
}

export type DecisionUpsertInput = {
  t: number;
  activePoolId: string;
  activeApy: number;
  bestPoolId: string;
  bestApy: number;
  deltaBps: number;
  assetsBefore: number;
  expectedGain: number;
  rebalanceFee: number;
  shouldRebalance: boolean;
  reason: string;
  assetsAfterFee: number;
  assetsAfterGrowth: number;
  windowSeconds: number;
  updatedAt: number;
};

export function replaceRebalanceDecisions(rows: DecisionUpsertInput[]) {
  const db = getMarketDb();
  const deleteStmt = db.prepare(`DELETE FROM rebalance_decisions WHERE t_ms >= ?`);
  const insertStmt = db.prepare(`
    INSERT INTO rebalance_decisions(
      t_ms,
      active_pool_id,
      active_apy_pct,
      best_pool_id,
      best_apy_pct,
      delta_bps,
      assets_before,
      expected_gain,
      rebalance_fee,
      should_rebalance,
      reason,
      assets_after_fee,
      assets_after_growth,
      window_seconds,
      updated_at_ms
    )
    VALUES(
      @t,
      @activePoolId,
      @activeApy,
      @bestPoolId,
      @bestApy,
      @deltaBps,
      @assetsBefore,
      @expectedGain,
      @rebalanceFee,
      @shouldRebalance,
      @reason,
      @assetsAfterFee,
      @assetsAfterGrowth,
      @windowSeconds,
      @updatedAt
    )
    ON CONFLICT(t_ms) DO UPDATE SET
      active_pool_id=excluded.active_pool_id,
      active_apy_pct=excluded.active_apy_pct,
      best_pool_id=excluded.best_pool_id,
      best_apy_pct=excluded.best_apy_pct,
      delta_bps=excluded.delta_bps,
      assets_before=excluded.assets_before,
      expected_gain=excluded.expected_gain,
      rebalance_fee=excluded.rebalance_fee,
      should_rebalance=excluded.should_rebalance,
      reason=excluded.reason,
      assets_after_fee=excluded.assets_after_fee,
      assets_after_growth=excluded.assets_after_growth,
      window_seconds=excluded.window_seconds,
      updated_at_ms=excluded.updated_at_ms
  `);

  const tx = db.transaction(() => {
    deleteStmt.run(MARKET_APY_START_MS);
    for (const row of rows) {
      insertStmt.run({
        t: row.t,
        activePoolId: row.activePoolId,
        activeApy: row.activeApy,
        bestPoolId: row.bestPoolId,
        bestApy: row.bestApy,
        deltaBps: row.deltaBps,
        assetsBefore: row.assetsBefore,
        expectedGain: row.expectedGain,
        rebalanceFee: row.rebalanceFee,
        shouldRebalance: row.shouldRebalance ? 1 : 0,
        reason: row.reason,
        assetsAfterFee: row.assetsAfterFee,
        assetsAfterGrowth: row.assetsAfterGrowth,
        windowSeconds: row.windowSeconds,
        updatedAt: row.updatedAt,
      });
    }
  });

  tx();
}

export function readLatestPointTimestampMs(): number {
  const db = getMarketDb();
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(t_ms), 0) AS max_t
      FROM market_apy_points
    `
    )
    .get() as { max_t: number };

  return Number(row.max_t ?? 0);
}

export function readLatestFetchFinishedMs(): number {
  const db = getMarketDb();
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(finished_at_ms), 0) AS latest
      FROM market_fetch_runs
      WHERE status = 'ok'
    `
    )
    .get() as { latest: number };

  return Number(row.latest ?? 0);
}

export function readLastFetchRunSummary():
  | { id: number; status: string; message: string; startedAt: number; finishedAt: number }
  | null {
  const db = getMarketDb();
  const row = db
    .prepare(
      `
      SELECT
        id,
        status,
        COALESCE(message, '') AS message,
        COALESCE(started_at_ms, 0) AS started_at,
        COALESCE(finished_at_ms, 0) AS finished_at
      FROM market_fetch_runs
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get() as
    | { id: number; status: string; message: string; started_at: number; finished_at: number }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    status: row.status,
    message: row.message,
    startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at),
  };
}

export function readLatestFetchRunItems(limit = 20): FetchRunItemSummary[] {
  const db = getMarketDb();
  const rows = db
    .prepare(
      `
      SELECT
        i.pool_id,
        COALESCE(p.name, i.pool_id) AS pool_name,
        i.attempts,
        i.http_status,
        i.status,
        i.points_count,
        COALESCE(i.message, '') AS message
      FROM market_fetch_run_items i
      LEFT JOIN market_pools p
      ON p.id = i.pool_id
      WHERE i.run_id = (SELECT id FROM market_fetch_runs ORDER BY id DESC LIMIT 1)
      ORDER BY i.pool_id ASC
      LIMIT ?
    `
    )
    .all(limit) as RawFetchRunItemRow[];

  return rows.map((row) => ({
    poolId: row.pool_id,
    poolName: row.pool_name,
    attempts: Number(row.attempts),
    httpStatus: row.http_status === null ? null : Number(row.http_status),
    status: row.status,
    pointsCount: Number(row.points_count),
    message: row.message,
  }));
}

export function readStoredMarketSnapshot(limitDecisions = 720): StoredMarketSnapshot {
  const db = getMarketDb();
  const pools = (db
    .prepare(
      `
      SELECT id, name, project, symbol, color
      FROM market_pools
      ORDER BY rowid ASC
    `
    )
    .all() as RawPoolRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    project: row.project,
    symbol: row.symbol,
    color: row.color,
    points: [] as MarketPoint[],
  }));

  const pointsStmt = db.prepare(
    `
    SELECT t_ms, apy_pct
    FROM market_apy_points
    WHERE pool_id = ? AND t_ms >= ?
    ORDER BY t_ms ASC
  `
  );

  let endMs = MARKET_APY_START_MS;
  for (const pool of pools) {
    const points = pointsStmt.all(pool.id, MARKET_APY_START_MS) as RawApyPoint[];
    pool.points = points.map((point) => ({
      t: Number(point.t_ms),
      apy: Number(point.apy_pct),
    }));
    const poolLatest = pool.points[pool.points.length - 1]?.t ?? MARKET_APY_START_MS;
    endMs = Math.max(endMs, poolLatest);
  }

  const poolNameMap = getPoolNameMap(db);
  const decisionsRows = db
    .prepare(
      `
      SELECT
        t_ms,
        active_pool_id,
        active_apy_pct,
        best_pool_id,
        best_apy_pct,
        delta_bps,
        assets_before,
        expected_gain,
        rebalance_fee,
        should_rebalance,
        reason,
        assets_after_fee,
        assets_after_growth,
        window_seconds,
        updated_at_ms
      FROM rebalance_decisions
      ORDER BY t_ms DESC
      LIMIT ?
    `
    )
    .all(limitDecisions) as RawDecisionRow[];

  const decisions: RebalanceDecision[] = decisionsRows
    .map((row) => ({
      t: Number(row.t_ms),
      activePoolId: row.active_pool_id,
      activePoolName: poolNameMap.get(row.active_pool_id) ?? row.active_pool_id,
      activeApy: Number(row.active_apy_pct),
      bestPoolId: row.best_pool_id,
      bestPoolName: poolNameMap.get(row.best_pool_id) ?? row.best_pool_id,
      bestApy: Number(row.best_apy_pct),
      deltaBps: Number(row.delta_bps),
      assetsBefore: Number(row.assets_before),
      expectedGain: Number(row.expected_gain),
      rebalanceFee: Number(row.rebalance_fee),
      shouldRebalance: row.should_rebalance === 1,
      reason: row.reason,
      assetsAfterFee: Number(row.assets_after_fee),
      assetsAfterGrowth: Number(row.assets_after_growth),
      windowSeconds: Number(row.window_seconds),
      updatedAt: Number(row.updated_at_ms),
    }))
    .sort((a, b) => a.t - b.t);

  const updatedAt = Math.max(readLatestFetchFinishedMs(), endMs, MARKET_APY_START_MS);

  return {
    startMs: MARKET_APY_START_MS,
    endMs,
    updatedAt,
    pools,
    decisions,
  };
}
