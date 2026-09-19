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
    const POOL = dep.POOL;

    if (!MUSDC) throw new Error("deployments.local.json missing MUSDC. Run 00_deploy_mocks.ts first.");
    if (!POOL) throw new Error("deployments.local.json missing POOL. Run 01_deploy_pool.ts first.");

    console.log("Using asset (mUSDC):", MUSDC);
    console.log("Using pool:", POOL);

    // ✅ 强制读对 artifact（全限定名），避免同名/旧 artifact
    const artifact = await hre.artifacts.readArtifact("contracts/StrategyVault.sol:StrategyVault");
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);

    // 自动识别 constructor 参数数量
    const ctor = artifact.abi.find((x: any) => x.type === "constructor");
    const inputs = ctor?.inputs ?? [];
    console.log("StrategyVault constructor inputs:", inputs.map((i: any) => `${i.name}:${i.type}`).join(", "));

    let args: any[] = [];
    if (inputs.length === 2) {
        args = [MUSDC, POOL];
    } else if (inputs.length === 3) {
        args = [MUSDC, POOL, deployerAddr];
    } else if (inputs.length === 1) {
        args = [MUSDC];
    } else if (inputs.length === 0) {
        args = [];
    } else {
        throw new Error(`Unsupported constructor length: ${inputs.length}. Please check StrategyVault.sol constructor.`);
    }

    console.log("Deploy args:", args);

    const vault = await factory.deploy(...args);
    await vault.waitForDeployment();

    const vaultAddr = await vault.getAddress();
    console.log("StrategyVault deployed:", vaultAddr);

    dep.VAULT = vaultAddr;
    fs.writeFileSync("deployments.local.json", JSON.stringify(dep, null, 2));
    console.log("Saved deployments.local.json ✅");

    // ✅ 试着把 pool 绑定到 vault（如果 MockPool 有 setVault）
    try {
        const poolArt = await hre.artifacts.readArtifact("contracts/MockPool.sol:MockPool");
        const pool = new ethers.Contract(POOL, poolArt.abi, deployer);
        if (typeof (pool as any).setVault === "function") {
            const tx = await (pool as any).setVault(vaultAddr);
            await tx.wait();
            console.log("MockPool.setVault(vault) ✅");
        } else {
            console.log("MockPool has no setVault() - skip");
        }
    } catch (e) {
        console.log("setVault step skipped (non-fatal):", (e as any).shortMessage ?? (e as any).message ?? e);
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
