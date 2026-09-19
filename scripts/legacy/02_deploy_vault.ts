// scripts/02_deploy_vault.ts
import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // ✅ 用 NonceManager，避免 "nonce has already been used / nonce too low"
  const rawDeployer = new ethers.Wallet(DEPLOYER_PK, provider);
  const deployer = new ethers.NonceManager(rawDeployer);

  console.log("Deployer:", await deployer.getAddress());

  // ✅ 从 deployments.local.json 读取 MUSDC / POOL
  const deployments = JSON.parse(fs.readFileSync("deployments.local.json", "utf-8"));
  const MUSDC: string = deployments.MUSDC;
  const POOL: string = deployments.POOL;

  if (!MUSDC || !POOL) {
    throw new Error(
      "deployments.local.json missing MUSDC or POOL. Run 00_deploy_mocks.ts and 01_deploy_pool.ts first."
    );
  }

  console.log("Using asset (mUSDC):", MUSDC);
  console.log("Using pool:", POOL);

  // 读取 StrategyVault artifact
  const vaultArt = await hre.artifacts.readArtifact("StrategyVault");
  const factory = new ethers.ContractFactory(vaultArt.abi, vaultArt.bytecode, deployer);

  // 部署 Vault(asset, pool)
  const vault = await factory.deploy(MUSDC, POOL);
  await vault.waitForDeployment();

  const vaultAddr = await vault.getAddress();
  console.log("StrategyVault deployed:", vaultAddr);

  // ✅ 把 pool.setVault(vault) 跑掉（onlyOwner）
  const poolArt = await hre.artifacts.readArtifact("MockPool");
  const pool = new ethers.Contract(POOL, poolArt.abi, deployer);

  const tx = await pool.setVault(vaultAddr);
  console.log("setVault tx:", tx.hash);
  await tx.wait();

  console.log("MockPool vault updated to:", vaultAddr);

  // ✅ 写回 deployments.local.json
  fs.writeFileSync(
    "deployments.local.json",
    JSON.stringify({ ...deployments, VAULT: vaultAddr }, null, 2)
  );
  console.log("Updated deployments.local.json with VAULT ✅");

  // ✅ 简单 sanity check：调用 vault.totalAssets()（应返回 uint256，不应 BAD_DATA）
  const ta = await vault.totalAssets();
  console.log("Vault totalAssets (sanity):", ta.toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
