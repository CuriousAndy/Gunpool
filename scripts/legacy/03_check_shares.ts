// scripts/03_check_shares.ts
import { ethers } from "ethers";
import hre from "hardhat";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error("ASSERT FAIL: " + msg);
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // deployer 钱包（用来 simulateProfit / mint）
    const rawDeployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const deployer = new ethers.NonceManager(rawDeployer);

    // hardhat node 默认账户（alice / bob）
    const alice = await provider.getSigner(1);
    const bob = await provider.getSigner(2);

    const aliceAddr = await alice.getAddress();
    const bobAddr = await bob.getAddress();
    console.log("Alice:", aliceAddr);
    console.log("Bob  :", bobAddr);

    // ✅ 从 deployments.local.json 读取最新地址
    const deployments = JSON.parse(fs.readFileSync("deployments.local.json", "utf-8"));
    const MUSDC: string = deployments.MUSDC;
    const POOL: string = deployments.POOL;
    const VAULT: string = deployments.VAULT;

    if (!MUSDC || !POOL || !VAULT) {
        throw new Error("deployments.local.json missing MUSDC/POOL/VAULT. Run 00/01/02 scripts first.");
    }

    console.log("Using MUSDC:", MUSDC);
    console.log("Using POOL :", POOL);
    console.log("Using VAULT:", VAULT);

    const one = 10n ** 6n; // 6 decimals (mUSDC)

    // 用 hardhat artifacts 拿 ABI
    const musdcArt = await hre.artifacts.readArtifact("MockERC20");
    const poolArt = await hre.artifacts.readArtifact("MockPool");
    const vaultArt = await hre.artifacts.readArtifact("StrategyVault");

    const musdc = new ethers.Contract(MUSDC, musdcArt.abi, deployer);
    const pool = new ethers.Contract(POOL, poolArt.abi, deployer);
    const vault = new ethers.Contract(VAULT, vaultArt.abi, deployer);

    // 0) 给 Alice/Bob mint 一些 mUSDC
    await (await musdc.mint(aliceAddr, 1000n * one)).wait();
    await (await musdc.mint(bobAddr, 1000n * one)).wait();
    console.log("Minted mUSDC to Alice/Bob ✅");

    // 记录初始余额（护栏3要用）
    const aliceStart = await musdc.balanceOf(aliceAddr);
    const bobStart = await musdc.balanceOf(bobAddr);

    // 1) Alice deposit 20
    const musdcAlice = musdc.connect(alice);
    const vaultAlice = vault.connect(alice);

    await (await musdcAlice.approve(VAULT, 20n * one)).wait();
    await (await vaultAlice.deposit(20n * one)).wait();
    console.log("Alice deposit 20 ✅");

    // 2) simulate profit +2 to POOL
    await (await musdc.approve(POOL, 2n * one)).wait();
    await (await pool.simulateProfit(2n * one)).wait();
    console.log("Simulated profit +2 ✅");

    // ====== Guardrail #1: totalAssets 必须包含 profit ======
    const taAfterProfit = await vault.totalAssets();
    console.log("totalAssets after profit:", taAfterProfit.toString());
    assert(taAfterProfit >= 22n * one, "totalAssets did NOT include profit (+2)");
    console.log("✅ Guardrail #1 passed: totalAssets includes profit");

    // 3) Bob deposit 5
    const musdcBob = musdc.connect(bob);
    const vaultBob = vault.connect(bob);

    await (await musdcBob.approve(VAULT, 5n * one)).wait();
    await (await vaultBob.deposit(5n * one)).wait();
    console.log("Bob deposit 5 ✅");

    // 4) shares / NAV 信息
    const totalAssets = await vault.totalAssets();
    const totalShares = await vault.totalShares();
    const aShares = await vault.sharesOf(aliceAddr);
    const bShares = await vault.sharesOf(bobAddr);

    console.log("Vault totalAssets:", totalAssets.toString());
    console.log("Vault totalShares:", totalShares.toString());
    console.log("Alice shares:", aShares.toString());
    console.log("Bob shares  :", bShares.toString(), " <-- should be < 5000000");

    // ====== Guardrail #2 ======
    assert(bShares < 5n * one, "Bob shares should be < 5e6 after profit (no free-riding)");
    console.log("✅ Guardrail #2 passed: new depositor gets fewer shares after profit");

    const aAssetsEq = await vault.balanceOfAssets(aliceAddr);
    const bAssetsEq = await vault.balanceOfAssets(bobAddr);

    console.log("Alice assets-eq:", aAssetsEq.toString());
    console.log("Bob assets-eq  :", bAssetsEq.toString());

    // withdraw 前记录（护栏3）
    const taBeforeWithdraw = await vault.totalAssets();
    const sumEq = aAssetsEq + bAssetsEq;

    console.log("Before withdraw:");
    console.log("  totalAssets:", taBeforeWithdraw.toString());
    console.log("  sum(userEq):", sumEq.toString());

    assert(sumEq <= taBeforeWithdraw, "sum(userEq) should NOT exceed totalAssets");
    console.log("✅ Pre-check passed: sum(userEq) <= totalAssets");

    // 5) Withdraw all shares
    await (await vaultAlice.withdraw(aShares)).wait();
    await (await vaultBob.withdraw(bShares)).wait();
    console.log("Withdraw all ✅");

    const aliceFinal = await musdc.balanceOf(aliceAddr);
    const bobFinal = await musdc.balanceOf(bobAddr);

    console.log("Alice final mUSDC:", aliceFinal.toString());
    console.log("Bob final mUSDC  :", bobFinal.toString());
    console.log("Sum:", (aliceFinal + bobFinal).toString());

    // // ====== Guardrail #3: 资产守恒 ======
    // const aliceDelta = aliceFinal - aliceStart;
    // const bobDelta = bobFinal - bobStart;
    // const sumDelta = aliceDelta + bobDelta;

    // console.log("Deltas:");
    // console.log("  Alice delta:", aliceDelta.toString());
    // console.log("  Bob delta  :", bobDelta.toString());
    // console.log("  Sum delta  :", sumDelta.toString());

    // const diff =
    //     sumDelta > taBeforeWithdraw ? (sumDelta - taBeforeWithdraw) : (taBeforeWithdraw - sumDelta);
    // assert(diff <= 2n, "asset conservation failed: |sumDelta - totalAssets| too large");

    // console.log("✅ Guardrail #3 passed: asset conservation (within rounding)");

    // ====== Guardrail #3 (FIXED): profit conservation + dust accounting ======
    const aliceDelta = aliceFinal - aliceStart;
    const bobDelta = bobFinal - bobStart;
    const sumDelta = aliceDelta + bobDelta;

    console.log("Deltas:");
    console.log("  Alice delta:", aliceDelta.toString());
    console.log("  Bob delta  :", bobDelta.toString());
    console.log("  Sum delta  :", sumDelta.toString());

    // 注入的 profit（你上面就是 2 USDC）
    const profitInjected = 2n * one;

    // withdraw all 后，系统里可能会剩一点 rounding dust（通常 0 或 1）
    const poolBalAfter = await pool.totalAssets();       // token balance in pool
    const vaultBalAfter = await vault.vaultBalance();    // token balance in vault wallet
    const remainingDust = poolBalAfter + vaultBalAfter;

    console.log("After withdraw balances:");
    console.log("  Pool token bal :", poolBalAfter.toString());
    console.log("  Vault token bal:", vaultBalAfter.toString());
    console.log("  Remaining dust :", remainingDust.toString());

    // ✅ 关键断言：用户赚到的 + 合约剩下的 dust = profitInjected（允许极小误差）
    const lhs = sumDelta + remainingDust;
    const diff2 = lhs > profitInjected ? (lhs - profitInjected) : (profitInjected - lhs);

    assert(diff2 <= 2n, "profit conservation failed: |(sumDelta + dust) - profitInjected| too large");

    console.log("✅ Guardrail #3 passed: profit conservation (including rounding dust)");

}



main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
