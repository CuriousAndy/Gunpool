import rawDeployments from "../../deployments.local.json";

import { type HexAddr, ZERO_ADDR } from "./contracts";

type DeploymentsFile = {
  MUSDC?: string;
  VAULT?: string;
  POOL?: string;
  POOLS?: string[];
  [key: string]: unknown;
};

const deployments = rawDeployments as DeploymentsFile;

function toHexAddr(value: unknown): HexAddr {
  return typeof value === "string" ? (value as HexAddr) : ZERO_ADDR;
}

export const MUSDC_ADDR = toHexAddr(deployments.MUSDC);
export const VAULT_ADDR = toHexAddr(deployments.VAULT);
export const POOL_ADDR = toHexAddr(deployments.POOL);
export const POOL_ADDRS: HexAddr[] = Array.isArray(deployments.POOLS)
  ? deployments.POOLS.filter((v): v is HexAddr => typeof v === "string")
  : [];
