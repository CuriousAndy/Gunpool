import hre from "hardhat";
import fs from "fs";
import path from "path";
import { formatUnits, parseUnits } from "viem";

/**
 * Multi-user flow script for teacher demo:
 * - Uses multiple hardhat accounts as "users"
 * - Each user mints (if needed), approves, deposits
 * - Optionally withdraws some amount
 * - Exports users/transactions/positions JSON for "user data table"
 *
 * Run:
 *   npx hardhat run scripts/03_run_flow_multi_users.ts --network localhost
 */

// Deterministic pseudo-random generator (LCG) for reproducible "random" tests.
function makeLCG(seed: number) {
    let s = seed >>> 0;
    return () => {
        // Numerical Recipes LCG
        s = (1664525 * s + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

function randInt(rng: () => number, minIncl: number, maxIncl: number) {
    return Math.floor(rng() * (maxIncl - minIncl + 1)) + minIncl;
}

async function main() {
    const { viem } = (await hre.network.connect()) as any;

    const publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    if (!wallets?.length) throw new Error("No wallet clients found");

    const deployerWallet = wallets[0];
    const deployer = deployerWallet.account.address;

    // How many users to simulate
    const USER_COUNT = Number(process.env.USERS ?? "10");
    const users = wallets.slice(0, USER_COUNT);

    // Seeded randomness for reproducibility (teacher-friendly)
    const seed = Number(process.env.SEED ?? "20260203");
    const rng = makeLCG(seed);

    console.log("Deployer:", deployer);
    console.log("Sim users:", users.map((w: any) => w.account.address).join(", "));
    console.log("Seed:", seed);

    // Read deployments
    const depPath = path.join(process.cwd(), "deployments", "localhost.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const poolAddr = dep.mockPool as `0x${string}`;
    const vaultAddr = dep.vault as `0x${string}`;
    if (!poolAddr || !vaultAddr) {
        throw new Error('deployments/localhost.json must include "mockPool" and "vault"');
    }

    const pool = await viem.getContractAt("MockPool", poolAddr);
    const vault = await viem.getContractAt("StrategyVault", vaultAddr);

    // Determine token from chain config
    const vaultAsset = (await (vault as any).read.asset()) as `0x${string}`;
    const poolUnderlying = (await (pool as any).read.underlying()) as `0x${string}`;

    console.log("vault.asset    :", vaultAsset);
    console.log("pool.underlying:", poolUnderlying);

    if (vaultAsset.toLowerCase() !== poolUnderlying.toLowerCase()) {
        throw new Error(
            `Config mismatch: vault.asset(${vaultAsset}) != pool.underlying(${poolUnderlying}). Redeploy with aligned asset.`
        );
    }

    const asset = await viem.getContractAt("MockERC20", vaultAsset);

    // decimals helpers
    let decimals = 18;
    try {
        decimals = Number(await (asset as any).read.decimals());
    } catch { }
    const fmt = (x: bigint) => formatUnits(x, decimals);

    async function getTimestampFromReceipt(hash: `0x${string}`) {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
        return { receipt, timestamp: Number(block.timestamp) };
    }

    // Output folders
    const outDir = path.join(process.cwd(), "user_data");
    fs.mkdirSync(outDir, { recursive: true });

    type TxRow = {
        tx_hash: string;
        user_address: string;
        action: "mint" | "approve" | "deposit" | "withdraw";
        amount: string; // human
        raw_amount: string; // bigint as string
        block_number: string;
        timestamp: number;
    };

    type UserRow = {
        user_address: string;
        first_seen: number;
        last_seen: number;
    };

    type PositionRow = {
        user_address: string;
        user_asset_balance: string;
        vault_recorded_user_balance: string; // vault.userBalance[user]
    };

    const txRows: TxRow[] = [];
    const userMap = new Map<string, UserRow>();

    function upsertUser(user: string, ts: number) {
        const u = userMap.get(user);
        if (!u) {
            userMap.set(user, { user_address: user, first_seen: ts, last_seen: ts });
        } else {
            u.last_seen = Math.max(u.last_seen, ts);
        }
    }

    console.log("\n===== INIT GLOBAL STATE =====");
    {
        const vaultBal = (await (asset as any).read.balanceOf([vaultAddr])) as bigint;
        const poolBal = (await (asset as any).read.balanceOf([poolAddr])) as bigint;
        console.log("vault asset:", fmt(vaultBal));
        console.log("pool  asset:", fmt(poolBal));
    }

    // For each user: mint (if needed) -> approve -> deposit -> optionally withdraw
    for (let i = 0; i < users.length; i++) {
        const w = users[i];
        const user = w.account.address;

        // Random deposit amount: 50~500 tokens (integer), deterministic via seed
        const depositInt = randInt(rng, 50, 500);
        const depositAmount = parseUnits(String(depositInt), decimals);

        // Optional withdraw: 0~50% of deposit
        const withdrawBps = randInt(rng, 0, 5000); // 0% ~ 50.00%
        const withdrawAmount = (depositAmount * BigInt(withdrawBps)) / 10000n;

        console.log(`\n----- USER ${i + 1}/${users.length}: ${user} -----`);
        console.log("deposit:", depositInt, "tokens; withdraw bps:", withdrawBps);

        // 1) Ensure user has enough tokens (mint difference). We use deployer to mint for all users.
        const bal0 = (await (asset as any).read.balanceOf([user])) as bigint;
        if (bal0 < depositAmount) {
            const need = depositAmount - bal0;
            console.log("Minting to user:", fmt(need));
            const hash = await (asset as any).write.mint([user, need], {
                account: deployerWallet.account,
            });
            const { receipt, timestamp } = await getTimestampFromReceipt(hash);
            txRows.push({
                tx_hash: hash,
                user_address: user,
                action: "mint",
                amount: fmt(need),
                raw_amount: need.toString(),
                block_number: receipt.blockNumber.toString(),
                timestamp,
            });
            upsertUser(user, timestamp);
        }

        // 2) Approve vault
        console.log("Approving...");
        {
            const hash = await (asset as any).write.approve([vaultAddr, depositAmount], {
                account: w.account,
            });
            const { receipt, timestamp } = await getTimestampFromReceipt(hash);
            txRows.push({
                tx_hash: hash,
                user_address: user,
                action: "approve",
                amount: fmt(depositAmount),
                raw_amount: depositAmount.toString(),
                block_number: receipt.blockNumber.toString(),
                timestamp,
            });
            upsertUser(user, timestamp);
        }

        // 3) Deposit
        console.log("Depositing...");
        {
            const hash = await (vault as any).write.deposit([depositAmount], {
                account: w.account,
            });
            const { receipt, timestamp } = await getTimestampFromReceipt(hash);
            txRows.push({
                tx_hash: hash,
                user_address: user,
                action: "deposit",
                amount: fmt(depositAmount),
                raw_amount: depositAmount.toString(),
                block_number: receipt.blockNumber.toString(),
                timestamp,
            });
            upsertUser(user, timestamp);
        }

        // 4) Optional Withdraw
        if (withdrawAmount > 0n) {
            console.log("Withdrawing...", fmt(withdrawAmount));
            const hash = await (vault as any).write.withdraw([withdrawAmount], {
                account: w.account,
            });
            const { receipt, timestamp } = await getTimestampFromReceipt(hash);
            txRows.push({
                tx_hash: hash,
                user_address: user,
                action: "withdraw",
                amount: fmt(withdrawAmount),
                raw_amount: withdrawAmount.toString(),
                block_number: receipt.blockNumber.toString(),
                timestamp,
            });
            upsertUser(user, timestamp);
        }

        // Quick per-user state
        const bal1 = (await (asset as any).read.balanceOf([user])) as bigint;
        const recorded = (await (vault as any).read.userBalance([user])) as bigint;
        console.log("user asset:", fmt(bal1));
        console.log("vault.userBalance[user]:", fmt(recorded));
    }

    // Final positions snapshot
    const positions: PositionRow[] = [];
    for (const w of users) {
        const user = w.account.address;
        const userBal = (await (asset as any).read.balanceOf([user])) as bigint;
        const recorded = (await (vault as any).read.userBalance([user])) as bigint;
        positions.push({
            user_address: user,
            user_asset_balance: fmt(userBal),
            vault_recorded_user_balance: fmt(recorded),
        });
    }

    const usersOut = Array.from(userMap.values()).sort((a, b) => a.user_address.localeCompare(b.user_address));

    fs.writeFileSync(path.join(outDir, "users.json"), JSON.stringify(usersOut, null, 2));
    fs.writeFileSync(path.join(outDir, "transactions.json"), JSON.stringify(txRows, null, 2));
    fs.writeFileSync(path.join(outDir, "positions.json"), JSON.stringify(positions, null, 2));

    console.log("\n===== EXPORT DONE =====");
    console.log("users.json       ->", path.join(outDir, "users.json"));
    console.log("transactions.json->", path.join(outDir, "transactions.json"));
    console.log("positions.json   ->", path.join(outDir, "positions.json"));

    // Global end state
    console.log("\n===== FINAL GLOBAL STATE =====");
    {
        const vaultBal = (await (asset as any).read.balanceOf([vaultAddr])) as bigint;
        const poolBal = (await (asset as any).read.balanceOf([poolAddr])) as bigint;
        console.log("vault asset:", fmt(vaultBal));
        console.log("pool  asset:", fmt(poolBal));
    }

    console.log("\n✅ Multi-user flow complete (deterministic random, teacher-friendly).\n");
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
