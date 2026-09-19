import fs from "fs";

import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYER_PK =
  process.env.DEPLOYER_PK ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return undefined;
  return hit.slice(prefix.length).trim();
}

async function main() {
  const deployments = JSON.parse(
    fs.readFileSync("deployments.local.json", "utf8")
  ) as { MUSDC?: string };

  const musdc = deployments.MUSDC;
  if (!musdc) throw new Error("Missing MUSDC in deployments.local.json");

  const to = process.env.TO ?? readArg("to");
  if (!to) {
    throw new Error("Missing target address. Use env TO=0x... or --to=0x...");
  }
  if (!ethers.isAddress(to)) {
    throw new Error(`Invalid address: ${to}`);
  }

  const amountHuman = process.env.AMOUNT ?? readArg("amount") ?? "100";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(DEPLOYER_PK, provider);

  const erc20Abi = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function mint(address,uint256)",
  ];

  const token = new ethers.Contract(musdc, erc20Abi, signer);
  const [symbol, decimals] = await Promise.all([
    token.symbol() as Promise<string>,
    token.decimals() as Promise<number>,
  ]);

  const amount = ethers.parseUnits(amountHuman, Number(decimals));
  const balBefore = (await token.balanceOf(to)) as bigint;

  const tx = await token.mint(to, amount);
  await tx.wait();

  const balAfter = (await token.balanceOf(to)) as bigint;

  console.log("Token :", symbol);
  console.log("MUSDC :", musdc);
  console.log("To    :", to);
  console.log("Mint  :", amountHuman, `(raw=${amount.toString()})`);
  console.log("Tx    :", tx.hash);
  console.log("Before:", balBefore.toString());
  console.log("After :", balAfter.toString());
}

main().catch((e) => {
  console.error(e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
