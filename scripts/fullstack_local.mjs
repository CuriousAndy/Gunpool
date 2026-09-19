import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ethers, isAddress } from "ethers";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Hardhat test account #2
const DEFAULT_AMOUNT = "100";
const DEFAULT_WALLET_ETH_TARGET = "200";
const DEFAULT_APY_SYNC_INTERVAL_MS = "3600000";
const CHAIN_ID = "31337";
const CHAIN_MNEMONIC = "test test test test test test test test test test test junk";
const CHAIN_HD_PATH = "m/44'/60'/0'/0";
const CHAIN_DB_PATH = path.resolve(PROJECT_ROOT, ".local", "ganache-db");
const GANACHE_CLI = path.resolve(PROJECT_ROOT, "node_modules", "ganache", "dist", "node", "cli.js");
const DEPLOYMENTS_FILE = path.resolve(PROJECT_ROOT, "deployments.local.json");
const DEPLOYMENT_OUTPUTS = [
  path.resolve(PROJECT_ROOT, "deployments.local.json"),
  path.resolve(PROJECT_ROOT, "gunpool-frontend/deployments.local.json"),
];

const isWindows = process.platform === "win32";
const NPX_BIN = "npx";
const NPM_BIN = "npm";
const FRONTEND_DIR = path.resolve(PROJECT_ROOT, "gunpool-frontend");
const FRONTEND_LOCK = path.join(FRONTEND_DIR, ".next", "dev", "lock");

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length).trim();
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function spawnCommand(cmd, args, extra = {}) {
  return spawn(cmd, args, {
    stdio: "inherit",
    shell: isWindows,
    cwd: PROJECT_ROOT,
    ...extra,
  });
}

function parseRpcEndpoint(rpcUrl) {
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "http:") {
    throw new Error(`Only http RPC URLs are supported for local startup: ${rpcUrl}`);
  }

  const port = parsed.port === "" ? 80 : Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid RPC port in URL: ${rpcUrl}`);
  }

  return { host: parsed.hostname, port };
}

function spawnGanache(rpcUrl) {
  if (!fs.existsSync(GANACHE_CLI)) {
    throw new Error(
      "Ganache CLI is missing. Run `npm install` so local persistent chain can start."
    );
  }

  const { host, port } = parseRpcEndpoint(rpcUrl);
  fs.mkdirSync(path.dirname(CHAIN_DB_PATH), { recursive: true });

  const args = [
    GANACHE_CLI,
    "--server.host",
    host,
    "--server.port",
    String(port),
    "--chain.chainId",
    CHAIN_ID,
    "--chain.networkId",
    CHAIN_ID,
    "--wallet.mnemonic",
    CHAIN_MNEMONIC,
    "--wallet.hdPath",
    CHAIN_HD_PATH,
    "--wallet.totalAccounts",
    "20",
    "--wallet.defaultBalance",
    "10000",
    "--database.dbPath",
    CHAIN_DB_PATH,
  ];

  return spawn(process.execPath, args, {
    stdio: "inherit",
    shell: false,
  });
}

function terminateProcessTree(child) {
  if (!child || child.killed) return;

  if (isWindows) {
    // Kill process tree on Windows (cmd + spawned process).
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: true,
    });
    return;
  }

  child.kill("SIGTERM");
}

async function runStep(title, cmd, args, options = {}) {
  console.log(`\n[step] ${title}`);
  console.log(`> ${cmd} ${args.join(" ")}`);

  await new Promise((resolve, reject) => {
    const child = spawnCommand(cmd, args, options);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `${title} failed (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    });
  });
}

async function rpcRequest(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed (${res.status}) for ${method}`);
  }

  return await res.json();
}

async function rpcAlive(rpcUrl) {
  try {
    const data = await rpcRequest(rpcUrl, "eth_chainId", []);
    return Boolean(data?.result);
  } catch {
    return false;
  }
}

async function getClientVersion(rpcUrl) {
  try {
    const data = await rpcRequest(rpcUrl, "web3_clientVersion", []);
    if (typeof data?.result === "string") return data.result;
    return "";
  } catch {
    return "";
  }
}

function isGanacheClient(clientVersion) {
  return /ganache/i.test(clientVersion);
}

async function waitForRpc(rpcUrl, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await rpcAlive(rpcUrl)) return;
    await delay(1000);
  }
  throw new Error(`RPC not ready after ${timeoutMs}ms: ${rpcUrl}`);
}

function resolveFrontendLockState() {
  if (!fs.existsSync(FRONTEND_LOCK)) {
    return { state: "missing" };
  }

  try {
    // If we can open it, it's likely stale lock from a previous crash.
    const fd = fs.openSync(FRONTEND_LOCK, "r+");
    fs.closeSync(fd);
    fs.unlinkSync(FRONTEND_LOCK);
    return { state: "cleared-stale" };
  } catch (error) {
    const code = error && error.code ? String(error.code) : "";
    if (code === "EBUSY" || code === "EPERM") {
      return { state: "active" };
    }
    return { state: "unknown", error };
  }
}

function clearPersistentStateFiles() {
  if (fs.existsSync(CHAIN_DB_PATH)) {
    fs.rmSync(CHAIN_DB_PATH, { recursive: true, force: true });
    console.log(`[ok] Cleared chain database: ${CHAIN_DB_PATH}`);
  }

  for (const output of DEPLOYMENT_OUTPUTS) {
    if (!fs.existsSync(output)) continue;
    fs.rmSync(output, { force: true });
    console.log(`[ok] Removed stale deployment file: ${output}`);
  }
}

async function isBootstrapStatePresent(rpcUrl) {
  if (!fs.existsSync(DEPLOYMENTS_FILE)) return false;

  let deployments;
  try {
    deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
  } catch {
    return false;
  }

  const required = [deployments?.MUSDC, deployments?.VAULT];
  const pools = Array.isArray(deployments?.POOLS) ? deployments.POOLS : [];
  const addressesToCheck = [...required, ...pools.slice(0, 1)];

  if (addressesToCheck.length < 2) return false;
  if (addressesToCheck.some((value) => !isAddress(String(value)))) {
    return false;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    for (const addr of addressesToCheck) {
      const code = await provider.getCode(addr);
      if (code === "0x") return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureWalletEth(rpcUrl, wallet, targetEth) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const targetWei = ethers.parseEther(targetEth);
  const beforeWei = await provider.getBalance(wallet);

  if (beforeWei >= targetWei) {
    console.log(
      `[ok] Wallet ETH is sufficient (${ethers.formatEther(beforeWei)} ETH >= ${targetEth} ETH target)`
    );
    return;
  }

  const topUpWei = targetWei - beforeWei;
  const funder = ethers.HDNodeWallet.fromPhrase(
    CHAIN_MNEMONIC,
    undefined,
    `${CHAIN_HD_PATH}/0`
  ).connect(provider);

  console.log(
    `[step] Top up ETH for ${wallet} (+${ethers.formatEther(topUpWei)} ETH to reach ${targetEth} ETH)`
  );
  const tx = await funder.sendTransaction({ to: wallet, value: topUpWei });
  const receipt = await tx.wait();
  const afterWei = await provider.getBalance(wallet, receipt?.blockNumber ?? "latest");
  if (afterWei < targetWei) {
    throw new Error(
      `ETH top-up check failed: balance ${ethers.formatEther(afterWei)} ETH is below target ${targetEth} ETH`
    );
  }
  console.log(
    `[ok] Wallet ETH balance is now ${ethers.formatEther(afterWei)} ETH`
  );
}

function createAdminEnv(rpcUrl, apys) {
  const env = { ...process.env, RPC_URL: rpcUrl };
  if (apys) env.APYS_BPS = apys;
  return env;
}

async function runApySyncStep(rpcUrl, apys, title = "Sync real APY + rebalance") {
  await runStep(title, NPX_BIN, [
    "hardhat",
    "run",
    "--network",
    "localhost",
    "scripts/05_admin_set_apys_and_rebalance.ts",
  ], {
    env: createAdminEnv(rpcUrl, apys),
  });
}

async function main() {
  const rpcUrl = parseArg("rpc", process.env.LOCAL_RPC_URL ?? DEFAULT_RPC_URL);
  const wallet = parseArg("wallet", process.env.LOCAL_WALLET ?? DEFAULT_WALLET);
  const amount = parseArg("amount", process.env.LOCAL_FAUCET_AMOUNT ?? DEFAULT_AMOUNT);
  const apys = parseArg("apys", process.env.LOCAL_APYS_BPS ?? "");
  const apySyncIntervalRaw = parseArg(
    "apy-sync-ms",
    process.env.LOCAL_APY_SYNC_INTERVAL_MS ?? DEFAULT_APY_SYNC_INTERVAL_MS
  );
  const walletEthTarget = parseArg(
    "wallet-eth",
    process.env.LOCAL_WALLET_ETH_TARGET ?? DEFAULT_WALLET_ETH_TARGET
  );

  const once = hasFlag("once");
  const noFrontend = hasFlag("no-frontend");
  const resetChain = hasFlag("reset-chain");
  const forceBootstrap = hasFlag("force-bootstrap");
  const allowNonPersistent = hasFlag("allow-non-persistent");

  if (!isAddress(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }
  try {
    ethers.parseEther(walletEthTarget);
  } catch {
    throw new Error(`Invalid --wallet-eth value: ${walletEthTarget}`);
  }
  const apySyncIntervalMs = Number(apySyncIntervalRaw);
  if (!Number.isFinite(apySyncIntervalMs) || apySyncIntervalMs < 0) {
    throw new Error(`Invalid --apy-sync-ms value: ${apySyncIntervalRaw}`);
  }

  let chainProcess = null;
  let frontendProcess = null;
  let chainStartedByScript = false;
  let apySyncTimer = null;
  let apySyncRunning = false;

  const stopApySyncLoop = () => {
    if (apySyncTimer) clearInterval(apySyncTimer);
    apySyncTimer = null;
  };

  const cleanup = () => {
    stopApySyncLoop();
    terminateProcessTree(frontendProcess);
    if (chainStartedByScript) terminateProcessTree(chainProcess);
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  try {
    let hasRunningRpc = await rpcAlive(rpcUrl);
    if (resetChain) {
      if (hasRunningRpc) {
        throw new Error(
          "Cannot use --reset-chain while another RPC is already running. Stop it first and rerun."
        );
      }
      clearPersistentStateFiles();
    }

    if (hasRunningRpc) {
      const clientVersion = await getClientVersion(rpcUrl);
      if (!isGanacheClient(clientVersion) && !allowNonPersistent) {
        throw new Error(
          `Detected non-persistent RPC at ${rpcUrl} (${clientVersion || "unknown client"}). ` +
            "Stop it first so this script can launch persistent Ganache, or pass --allow-non-persistent to bypass."
        );
      }
      if (!isGanacheClient(clientVersion) && allowNonPersistent) {
        console.log(
          `[warn] Reusing non-persistent RPC (${clientVersion || "unknown client"}); state persistence is not guaranteed.`
        );
      } else {
        console.log(`[ok] Reusing existing local RPC: ${rpcUrl}`);
      }
    } else {
      console.log(`[start] Launching persistent local chain: ${rpcUrl}`);
      chainProcess = spawnGanache(rpcUrl);
      chainStartedByScript = true;
      await waitForRpc(rpcUrl);
      hasRunningRpc = true;
      console.log(`[ok] Local chain is ready (db: ${CHAIN_DB_PATH})`);
    }

    if (!hasRunningRpc) {
      throw new Error(`RPC is not reachable at ${rpcUrl}`);
    }

    await ensureWalletEth(rpcUrl, wallet, walletEthTarget);

    const deploymentsFileExists = fs.existsSync(DEPLOYMENTS_FILE);
    const hasBootstrapState = await isBootstrapStatePresent(rpcUrl);

    if (deploymentsFileExists && !hasBootstrapState && !forceBootstrap && !resetChain) {
      throw new Error(
        "Detected deployment file but no matching contracts on current RPC. " +
          "To prevent accidental asset reset, auto-bootstrap is blocked. " +
          `Check that persistent Ganache DB is reused (${CHAIN_DB_PATH}) and RPC is correct (${rpcUrl}). ` +
          "If you intentionally want a fresh chain, use --reset-chain. " +
          "If you intentionally redeploy on current chain, use --force-bootstrap."
      );
    }

    if (!hasBootstrapState || forceBootstrap) {
      if (forceBootstrap && hasBootstrapState) {
        console.log("[warn] --force-bootstrap enabled; deploying a fresh stack on current chain.");
      }

      await runStep("Compile contracts", NPX_BIN, ["hardhat", "compile"]);
      await runStep("Deploy vault + pools + bootstrap wallet", NPX_BIN, [
        "hardhat",
        "run",
        "--network",
        "localhost",
        "scripts/04_deploy_5_pools_and_vault.ts",
      ], {
        env: {
          ...process.env,
          RPC_URL: rpcUrl,
          BOOTSTRAP_WALLET: wallet,
          BOOTSTRAP_AMOUNT: amount,
        },
      });
    } else {
      console.log(
        "\n[ok] Existing on-chain state detected; skipping bootstrap to preserve persisted state."
      );
    }

    await runApySyncStep(rpcUrl, apys);

    if (!hasBootstrapState || forceBootstrap) {
      console.log("\n[ok] Bootstrap finished");
    }

    console.log(`  wallet: ${wallet}`);
    console.log(`  wallet ETH target: ${walletEthTarget}`);
    console.log(`  bootstrap amount (first run): ${amount} mUSDC`);
    console.log(`  rpc: ${rpcUrl}`);
    console.log(`  db: ${CHAIN_DB_PATH}`);

    if (!once && apySyncIntervalMs > 0) {
      console.log(
        `[ok] Auto APY sync is enabled every ${Math.round(
          apySyncIntervalMs / 1000
        )} seconds`
      );
      apySyncTimer = setInterval(async () => {
        if (apySyncRunning) {
          return;
        }
        apySyncRunning = true;
        try {
          await runApySyncStep(rpcUrl, apys, "Periodic APY sync + rebalance");
        } catch (error) {
          console.error(
            `[warn] Periodic APY sync failed: ${error?.message ?? error}`
          );
        } finally {
          apySyncRunning = false;
        }
      }, apySyncIntervalMs);
    }

    if (once || noFrontend) {
      return;
    }

    const lockState = resolveFrontendLockState();
    if (lockState.state === "cleared-stale") {
      console.log("[ok] Cleared stale Next.js dev lock file.");
    } else if (lockState.state === "active") {
      console.log(
        "[ok] Detected an existing Next.js dev instance (lock is active). Reusing it and skipping frontend launch."
      );
      if (apySyncTimer) {
        await new Promise(() => {});
      }
      return;
    } else if (lockState.state === "unknown") {
      console.log(
        `[warn] Unable to inspect Next.js lock file, trying to launch frontend anyway: ${lockState.error?.message ?? lockState.error}`
      );
    }

    console.log("\n[start] Launching frontend dev server...");
    frontendProcess = spawnCommand(NPM_BIN, ["--prefix", "gunpool-frontend", "run", "dev"], {
      env: {
        ...process.env,
        NEXT_PUBLIC_HARDHAT_RPC_URL: rpcUrl,
      },
    });

    await new Promise((resolve, reject) => {
      frontendProcess.on("error", reject);
      frontendProcess.on("exit", (code, signal) => {
        if (code === 0 || code === null) return resolve();
        reject(
          new Error(
            `Frontend exited unexpectedly (code=${code}, signal=${signal ?? "null"})`
          )
        );
      });
    });
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
