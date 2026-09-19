import hre from "hardhat";

async function main() {
  const { viem } = (await hre.network.connect()) as any;

  const vaultAddr = "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82" as const;
  const vault = await viem.getContractAt("StrategyVault", vaultAddr);

  const poolAddr = await (vault as any).read.pool();
  const assetAddr = await (vault as any).read.asset();

  const pool = await viem.getContractAt("MockPool", poolAddr);
  const underlying = await (pool as any).read.underlying();
  const poolVault = await (pool as any).read.vault();

  console.log("vault      :", vaultAddr);
  console.log("vault.asset:", assetAddr);
  console.log("vault.pool :", poolAddr);
  console.log("pool.underlying:", underlying);
  console.log("pool.vault     :", poolVault);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
