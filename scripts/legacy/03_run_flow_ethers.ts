import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function readJson(p: string) {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const deployerAddr = await deployer.getAddress();

    console.log("Deployer:", deployerAddr);

    const dep = readJson("deployments.local.json");
    const MUSDC = dep.MUSDC;
    const VAULT = dep.VAULT;

    if (!MUSDC) throw new Error("Missing MUSDC in deployments.local.json");
    if (!VAULT) throw new Error("Missing VAULT in deployments.local.json. Run 02_deploy_vault_autofix.ts first.");

    const erc20Art = await hre.artifacts.readArtifact("contracts/MockERC20.sol:MockERC20");
    const vaultArt = await hre.artifacts.readArtifact("contracts/StrategyVault.sol:StrategyVault");

    const token = new ethers.Contract(MUSDC, erc20Art.abi, deployer);
    const vault = new ethers.Contract(VAULT, vaultArt.abi, deployer);

    // 先 mint 一点给 deployer（如果你的 MockERC20 有 mint）
    const amount = ethers.parseUnits("100", 18); // 如果你 mUSDC 不是 18 位，后面我再帮你调
    try {
        const txm = await (token as any).mint(deployerAddr, amount);
        await txm.wait();
        console.log("Minted 100 tokens to deployer ✅");
    } catch {
        console.log("mint skipped (maybe already minted / no mint function)");
    }

    // approve
    const tx1 = await token.approve(VAULT, amount);
    await tx1.wait();
    console.log("Approved ✅");

    // deposit
    const tx2 = await (vault as any).deposit(amount);
    await tx2.wait();
    console.log("Deposit ✅");

    // withdraw 一半
    const half = amount / 2n;
    const tx3 = await (vault as any).withdraw(half);
    await tx3.wait();
    console.log("Withdraw ✅");

    const bal = await token.balanceOf(deployerAddr);
    console.log("Deployer token balance:", bal.toString());

    // 如果 vault 有 userBalance 映射 getter
    try {
        const ub = await (vault as any).userBalance(deployerAddr);
        console.log("vault.userBalance[deployer]:", ub.toString());
    } catch {
        console.log("vault.userBalance() not available - skip");
    }

    console.log("\n✅ Flow finished.\n");
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
