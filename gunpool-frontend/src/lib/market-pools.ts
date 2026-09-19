export type MarketApyPool = {
  id: string;
  name: string;
  project: string;
  symbol: string;
  color: string;
};

export const MARKET_APY_START_MS = Date.UTC(2023, 0, 1, 0, 0, 0, 0);
export const MARKET_APY_START_TEXT = "2023-01-01 00:00 UTC";

// Real lending pools from DefiLlama yield chart IDs.
export const MARKET_APY_POOLS: MarketApyPool[] = [
  {
    id: "aa70268e-4b52-42bf-a116-608b370f9501",
    name: "Aave v3 USDC",
    project: "aave-v3",
    symbol: "USDC",
    color: "#4E73FF",
  },
  {
    id: "7da72d09-56ca-4ec5-a45f-59114353e487",
    name: "Compound v3 USDC",
    project: "compound-v3",
    symbol: "USDC",
    color: "#67CC8E",
  },
  {
    id: "65ce8276-b4d9-41ba-9f6f-21fc374cf9bc",
    name: "SparkLend USDC",
    project: "sparklend",
    symbol: "USDC",
    color: "#B8E93B",
  },
  {
    id: "4438dabc-7f0c-430b-8136-2722711ae663",
    name: "Fluid Lending USDC",
    project: "fluid-lending",
    symbol: "USDC",
    color: "#FF9A4D",
  },
  {
    id: "f4d5b566-e815-4ca2-bb07-7bcd8bc797f1",
    name: "Compound v3 USDT",
    project: "compound-v3",
    symbol: "USDT",
    color: "#D9DFE9",
  },
  {
    id: "f981a304-bb6c-45b8-b0c5-fd2f515ad23a",
    name: "Aave v3 USDT",
    project: "aave-v3",
    symbol: "USDT",
    color: "#1F78FF",
  },
  {
    id: "8fbe28b8-140d-4e37-8804-5d2aba4daded",
    name: "SparkLend USDT",
    project: "sparklend",
    symbol: "USDT",
    color: "#E7C62F",
  },
  {
    id: "4e8cc592-c8d5-4824-8155-128ba521e903",
    name: "Fluid Lending USDT",
    project: "fluid-lending",
    symbol: "USDT",
    color: "#FF6B57",
  },
  {
    id: "3665ee7e-6c5d-49d9-abb7-c47ab5d9d4ac",
    name: "Aave v3 DAI",
    project: "aave-v3",
    symbol: "DAI",
    color: "#14B8A6",
  },
  {
    id: "89eba1e5-1b1b-47b6-958b-38138a04c244",
    name: "Venus Core USDC",
    project: "venus-core-pool",
    symbol: "USDC",
    color: "#63C9F7",
  },
];
