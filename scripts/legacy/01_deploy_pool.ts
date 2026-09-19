import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

    console.log("Deployer:", await deployer.getAddress());

    // 读取 MUSDC
    const dep = JSON.parse(fs.readFileSync("deployments.local.json", "utf-8"));
    const MUSDC = dep.MUSDC;
    if (!MUSDC) throw new Error("deployments.local.json missing MUSDC. Run 00_deploy_mocks.ts first.");
    console.log("Using underlying (mUSDC):", MUSDC);

    // ✅ 强制读取正确 artifact（全限定名），避免同名合约/旧 artifact
    const artifact = await hre.artifacts.readArtifact("contracts/MockPool.sol:MockPool");

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);

    // ✅ MockPool constructor(address _underlying, uint256 initialApyBps)
    // bps: 800 = 8%
    const INITIAL_APY_BPS = 800;

    const pool = await factory.deploy(MUSDC, INITIAL_APY_BPS);
    await pool.waitForDeployment();

    const poolAddr = await pool.getAddress();
    console.log("MockPool deployed:", poolAddr);

    // 写入 deployments.local.json
    dep.POOL = poolAddr;
    fs.writeFileSync("deployments.local.json", JSON.stringify(dep, null, 2));
    console.log("Saved deployments.local.json ✅");
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
