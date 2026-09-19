import type { PublicClient } from "viem";

import {
  type HexAddr,
  ZERO_ADDR,
  isZeroAddress,
  poolAbi,
  vaultAbi,
} from "./contracts";

export type VaultSnapshot = {
  poolAddresses: HexAddr[];
  poolApysBps: bigint[];
  allocations: bigint[];
  activePool: HexAddr;
  bestPool: HexAddr;
  totalAssets: bigint;
  fetchedAtMs: number;
};

export function bpsToPct(bps: bigint): number {
  return Number(bps) / 100;
}

export function formatPctFromBps(bps: bigint): string {
  return `${bpsToPct(bps).toFixed(2)}%`;
}

export async function readVaultSnapshot(
  client: PublicClient,
  vault: HexAddr
): Promise<VaultSnapshot> {
  if (isZeroAddress(vault)) {
    return {
      poolAddresses: [],
      poolApysBps: [],
      allocations: [],
      activePool: ZERO_ADDR,
      bestPool: ZERO_ADDR,
      totalAssets: 0n,
      fetchedAtMs: Date.now(),
    };
  }

  const [poolsLengthRaw, activePoolRaw, bestPoolRaw, totalAssetsRaw] =
    await Promise.all([
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "poolsLength",
      }),
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "activePool",
      }),
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "bestPool",
      }),
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "totalAssets",
      }),
    ]);

  const poolsLength = Number(poolsLengthRaw);
  const poolAddresses: HexAddr[] = [];

  if (poolsLength > 0) {
    for (let i = 0; i < poolsLength; i++) {
      const p = (await client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "pools",
        args: [BigInt(i)],
      })) as HexAddr;
      poolAddresses.push(p);
    }
  }

  const [poolApysBps, allocations] = await Promise.all([
    Promise.all(
      poolAddresses.map(
        (p) =>
          client.readContract({
            address: p,
            abi: poolAbi,
            functionName: "apy",
          }) as Promise<bigint>
      )
    ),
    Promise.all(
      poolAddresses.map(
        (p) =>
          client.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: "allocated",
            args: [p],
          }) as Promise<bigint>
      )
    ),
  ]);

  return {
    poolAddresses,
    poolApysBps,
    allocations,
    activePool: activePoolRaw as HexAddr,
    bestPool: bestPoolRaw as HexAddr,
    totalAssets: totalAssetsRaw as bigint,
    fetchedAtMs: Date.now(),
  };
}
