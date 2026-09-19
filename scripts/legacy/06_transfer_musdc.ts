import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PK =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Hardhat test account #2 (replace with your own wallet)

async function main() {
    const d = JSON.parse(fs.readFileSync("deployments.local.json", "utf-8"));
    const MUSDC: string = d.MUSDC;
    if (!MUSDC) throw new Error("deployments.local.json missing MUSDC");

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

    console.log("MUSDC:", MUSDC);
    console.log("Deployer:", await deployer.getAddress());
    console.log("To:", TO);

    // ERC20 ABI（只读 + transfer）
    const erc20Abi = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address owner) view returns (uint256)",
        "function transfer(address to, uint256 amount) returns (bool)",
    ];

    const musdc = new ethers.Contract(MUSDC, erc20Abi, deployer);

    // 1) 读取 token 基本信息
    const [name, symbol, decimals] = await Promise.all([
        musdc.name().catch(() => "N/A"),
        musdc.symbol().catch(() => "N/A"),
        musdc.decimals().catch(() => 18),
    ]);

    console.log("Token name:", name);
    console.log("Token symbol:", symbol);
    console.log("Token decimals:", decimals);

    // 2) 查 deployer 和 TO 的余额
    const [balDeployer, balTo] = await Promise.all([
        musdc.balanceOf(await deployer.getAddress()),
        musdc.balanceOf(TO),
    ]);

    console.log("Deployer balance(raw):", balDeployer.toString());
    console.log("TO balance(raw):", balTo.toString());

    // 3) 转 100 个 token（按 decimals）
    const amount = ethers.parseUnits("100", Number(decimals));
    console.log("Transfer amount(raw):", amount.toString());

    const tx = await musdc.transfer(TO, amount);
    console.log("tx:", tx.hash);
    await tx.wait();

    const balTo2 = await musdc.balanceOf(TO);
    console.log("✅ transfer done. TO balance(raw):", balTo2.toString());
}

main().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message || e);
    process.exit(1);
});
