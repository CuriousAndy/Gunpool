import fs from "fs";
import path from "path";

import hre from "hardhat";
import { ethers, NonceManager } from "ethers";

const MNEMONIC = "test test test test test test test test test test test junk";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DEFAULT_BOOTSTRAP_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Hardhat test account #2

const DECIMALS = 6n;
const ONE = 10n ** DECIMALS;
const INITIAL_POOL_APYS_BPS = [300n, 450n, 520n, 610n, 800n];

const GAS_COST_ASSETS = 10_000n; // 0.01 mUSDC (6 decimals)
const GAIN_WINDOW_SECONDS = 7n * 24n * 60n * 60n; // 7 days

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function assertPersistentRpc(provider: ethers.JsonRpcProvider) {
  const clientVersion = await provider.send("web3_clientVersion", []);
  const allowNonPersistent = isTruthyEnv(process.env.ALLOW_NON_PERSISTENT_DEPLOY);
  const isGanache = typeof clientVersion === "string" && /ganache/i.test(clientVersion);

  if (isGanache || allowNonPersistent) return;

  throw new Error(
    `Refusing to deploy on non-persistent RPC (${clientVersion || "unknown"}). ` +
      "Use persistent Ganache (`npm run chain` / `npm run dev:local`). " +
      "If this is intentional, set ALLOW_NON_PERSISTENT_DEPLOY=1."
  );
}

async function deployFromArtifact(
  artifactName: string,
  args: unknown[],
  signer: ethers.Signer
) {
  const art = await hre.artifacts.readArtifact(artifactName);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, signer);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

function writeDeployments(payload: Record<string, unknown>) {
  const outFiles = [
    path.resolve("deployments.local.json"),
    path.resolve("gunpool-frontend/deployments.local.json"),
  ];

  for (const out of outFiles) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Saved ${out}`);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await assertPersistentRpc(provider);
  const bootstrapWallet = process.env.BOOTSTRAP_WALLET ?? DEFAULT_BOOTSTRAP_WALLET;
  const bootstrapAmountHuman = process.env.BOOTSTRAP_AMOUNT ?? "100";

  if (!ethers.isAddress(bootstrapWallet)) {
    throw new Error(`Invalid BOOTSTRAP_WALLET: ${bootstrapWallet}`);
  }

  const rawDeployer = ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    "m/44'/60'/0'/0/0"
  ).connect(provider);
  const rawAlice = ethers.HDNodeWallet.fromPhrase(
    MNEMONIC,
    undefined,
    "m/44'/60'/0'/0/1"
  ).connect(provider);

  const deployer = new NonceManager(rawDeployer);
  const alice = new NonceManager(rawAlice);

  const deployerAddr = await rawDeployer.getAddress();
  const aliceAddr = await rawAlice.getAddress();
  console.log("Deployer:", deployerAddr);
  console.log("Alice:", aliceAddr);

  const musdc = await deployFromArtifact(
    "MockERC20",
    ["Mock USDC", "mUSDC", 6],
    deployer
  );
  const musdcAddr = await musdc.getAddress();
  console.log("mUSDC:", musdcAddr);

  const vault = await deployFromArtifact("StrategyVault", [musdcAddr], deployer);
  const vaultAddr = await vault.getAddress();
  console.log("Vault:", vaultAddr);

  await (
    await vault
      .connect(deployer)
      .setRebalanceParams(GAS_COST_ASSETS, GAIN_WINDOW_SECONDS)
  ).wait();

  const poolAddrs: string[] = [];
  for (let i = 0; i < INITIAL_POOL_APYS_BPS.length; i++) {
    const apy = INITIAL_POOL_APYS_BPS[i];
    const pool = await deployFromArtifact("MockPool", [musdcAddr, apy], deployer);
    const poolAddr = await pool.getAddress();
    await (await pool.connect(deployer).setVault(vaultAddr)).wait();
    await (await vault.connect(deployer).addPool(poolAddr)).wait();
    poolAddrs.push(poolAddr);
    console.log(`Pool${i + 1} (${apy} bps): ${poolAddr}`);
  }

  const mintAmt = 100n * ONE;
  await (await musdc.connect(deployer).mint(aliceAddr, mintAmt)).wait();
  console.log("Minted 100 mUSDC to Alice");

  const bootstrapMintAmt = ethers.parseUnits(bootstrapAmountHuman, Number(DECIMALS));
  await (await musdc.connect(deployer).mint(bootstrapWallet, bootstrapMintAmt)).wait();
  console.log(
    `Minted ${bootstrapAmountHuman} mUSDC to bootstrap wallet ${bootstrapWallet}`
  );

  const depositAmt = 20n * ONE;
  await (await musdc.connect(alice).approve(vaultAddr, depositAmt)).wait();
  await (await vault.connect(alice).deposit(depositAmt)).wait();
  console.log("Alice deposited 20 mUSDC");

  const bestBefore = await vault.bestPool();
  const activeBefore = await vault.activePool();
  console.log("bestPool:", bestBefore);
  console.log("activePool:", activeBefore);

  const expectedGain = await vault.expectedGainIfRebalance(activeBefore, bestBefore);
  console.log("expectedGain:", expectedGain.toString());
  console.log("gasCostAssets:", (await vault.gasCostAssets()).toString());

  await (await vault.connect(deployer).rebalance()).wait();
  console.log("Rebalanced");

  for (let i = 0; i < poolAddrs.length; i++) {
    const allocated = await vault.allocated(poolAddrs[i]);
    console.log(`allocated[Pool${i + 1}] = ${allocated.toString()}`);
  }

  const payload = {
    MUSDC: musdcAddr,
    VAULT: vaultAddr,
    POOLS: poolAddrs,
    POOL: poolAddrs[0] ?? ZERO_ADDR, // backward compatibility
  };
  writeDeployments(payload);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
