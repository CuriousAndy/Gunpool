export type MarketPoolPoint = {
  t: number;
  apy: number;
};

export type MarketPoolPayload = {
  id: string;
  name: string;
  project: string;
  symbol: string;
  color: string;
  points: MarketPoolPoint[];
};

export type RebalanceDecisionPayload = {
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

export type FetchRunItemPayload = {
  poolId: string;
  poolName: string;
  attempts: number;
  httpStatus: number | null;
  status: "ok" | "error";
  pointsCount: number;
  message: string;
};

export type SystemProfilePayload = {
  fetchRetry: number;
  fetchTimeoutMs: number;
  fetchConcurrency: number;
  rebalanceWindowSeconds: number;
  rebalanceFeeRateBps: number;
  rebalanceFeeMinUsdc: number;
  rebalanceFeeUsdc: number;
  strategyStartAssets: number;
  database: string;
  startDate: string;
  antiCrawler: string;
};

export type MarketApyApiPayload = {
  ok: boolean;
  message?: string;
  startMs: number;
  endMs: number;
  updatedAt: number;
  pools: MarketPoolPayload[];
  decisions: RebalanceDecisionPayload[];
  sync?: {
    synced: boolean;
    runId?: number;
    message: string;
    successPools: string[];
    failedPools: string[];
  };
  lastRun?: {
    id: number;
    status: string;
    message: string;
    startedAt: number;
    finishedAt: number;
  } | null;
  fetchRunItems?: FetchRunItemPayload[];
  systemProfile?: SystemProfilePayload;
  dbPath?: string;
};
