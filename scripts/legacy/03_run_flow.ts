import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatUnits, parseUnits } from "viem";

async function main() {
  const { viem } = (await hre.network.connect()) as any;

  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const deployer = wallet.account.address;

  console.log("Deployer:", deployer);

  // 读取 deployments
  const depPath = path.join(process.cwd(), "deployments", "localhost.json");
  const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

  const poolAddr = dep.mockPool as `0x${string}`;
  const vaultAddr = dep.vault as `0x${string}`;
  if (!poolAddr || !vaultAddr) {
    throw new Error('deployments/localhost.json 必须包含 "mockPool" 和 "vault"');
  }

  // 先拿合约实例
  const pool = await viem.getContractAt("MockPool", poolAddr);
  const vault = await viem.getContractAt("StrategyVault", vaultAddr);

  // 用链上真实配置确定 token
  const vaultAsset = (await (vault as any).read.asset()) as `0x${string}`;
  const poolUnderlying = (await (pool as any).read.underlying()) as `0x${string}`;

  console.log("vault.asset    :", vaultAsset);
  console.log("pool.underlying:", poolUnderlying);

  if (vaultAsset.toLowerCase() !== poolUnderlying.toLowerCase()) {
    throw new Error(
      `❌ 配置错误：vault.asset(${vaultAsset}) != pool.underlying(${poolUnderlying})，请重部署对齐`
    );
  }

  const asset = await viem.getContractAt("MockERC20", vaultAsset);

  // decimals + format
  let decimals = 18;
  try {
    decimals = Number(await (asset as any).read.decimals());
  } catch { }
  const fmt = (x: bigint) => formatUnits(x, decimals);

  async function printState(tag: string) {
    const userBal = (await (asset as any).read.balanceOf([deployer])) as bigint;
    const vaultBal = (await (asset as any).read.balanceOf([vaultAddr])) as bigint;
    const poolBal = (await (asset as any).read.balanceOf([poolAddr])) as bigint;

    const userRecorded = (await (vault as any).read.userBalance([deployer])) as bigint;
    const poolVault = (await (pool as any).read.vault()) as `0x${string}`;

    console.log(`\n===== ${tag} =====`);
    console.log("user asset:", fmt(userBal));
    console.log("vault asset:", fmt(vaultBal));
    console.log("pool  asset:", fmt(poolBal));
    console.log("vault.userBalance[user]:", fmt(userRecorded));
    console.log("pool.vault:", poolVault);
  }

  await printState("INIT");

  // 1) 确保用户有钱（MockERC20 有 mint）
  const want = parseUnits("1000", decimals);
  const userBal0 = (await (asset as any).read.balanceOf([deployer])) as bigint;

  if (userBal0 < want) {
    console.log("\nMinting to user...");
    const hash = await (asset as any).write.mint([deployer, want - userBal0], {
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  await printState("AFTER_MINT");

  // 2) approve + deposit (StrategyVault.deposit(uint256))
  const amount = parseUnits("500", decimals);

  console.log("\nApproving vault...");
  {
    const hash = await (asset as any).write.approve([vaultAddr, amount], {
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  console.log("Depositing into StrategyVault (will forward into MockPool)...");
  {
    const hash = await (vault as any).write.deposit([amount], {
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  await printState("AFTER_DEPOSIT");

  // 3) withdraw (StrategyVault.withdraw(uint256))
  console.log("\nWithdrawing from StrategyVault...");
  {
    const hash = await (vault as any).write.withdraw([amount], {
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  await printState("AFTER_WITHDRAW");

  console.log("\n✅资金闭环（deposit→pool→withdraw）验证完成。");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
