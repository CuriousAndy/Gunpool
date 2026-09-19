import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYMENTS_FILE = path.resolve(PROJECT_ROOT, "deployments.local.json");
const FRONTEND_DEPLOYMENTS_FILE = path.resolve(
  PROJECT_ROOT,
  "gunpool-frontend",
  "deployments.local.json"
);
const DEPLOY_SCRIPT = "scripts/04_deploy_5_pools_and_vault.ts";
const FORCE_REDEPLOY = ["1", "true", "yes"].includes(
  String(process.env.FORCE_REDEPLOY ?? "").trim().toLowerCase()
);

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeAddress(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function getAddressesToCheck(deployments) {
  const musdc = normalizeAddress(deployments?.MUSDC);
  const vault = normalizeAddress(deployments?.VAULT);
  const pools = Array.isArray(deployments?.POOLS) ? deployments.POOLS : [];
  const normalizedPools = pools.map(normalizeAddress).filter(Boolean);

  if (!musdc || !vault || normalizedPools.length === 0) return [];
  const addresses = [musdc, vault, ...normalizedPools];
  if (addresses.some((address) => !ethers.isAddress(address))) return [];
  return addresses;
}

async function hasCodeAtAllAddresses(provider, addresses) {
  for (const address of addresses) {
    const code = await provider.getCode(address);
    if (!code || code === "0x") {
      return false;
    }
  }
  return true;
}

function runDeployScript() {
  const isWindows = process.platform === "win32";
  const child = spawn(
    "npx",
    ["hardhat", "run", "--network", "localhost", DEPLOY_SCRIPT],
    {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      shell: isWindows,
      env: {
        ...process.env,
        RPC_URL,
      },
    }
  );

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Deploy failed (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    });
  });
}

function syncFrontendDeploymentsIfNeeded() {
  const rootDeployments = readJsonIfExists(DEPLOYMENTS_FILE);
  if (!rootDeployments) return;

  const frontendDeployments = readJsonIfExists(FRONTEND_DEPLOYMENTS_FILE);
  if (
    frontendDeployments &&
    JSON.stringify(frontendDeployments) === JSON.stringify(rootDeployments)
  ) {
    return;
  }

  writeJson(FRONTEND_DEPLOYMENTS_FILE, rootDeployments);
  console.log(`[ok] Synced deployment file: ${FRONTEND_DEPLOYMENTS_FILE}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  try {
    await provider.getBlockNumber();
  } catch (error) {
    throw new Error(
      `RPC is not reachable at ${RPC_URL}. Start local chain first (npm run chain).`
    );
  }

  if (!FORCE_REDEPLOY) {
    const current = readJsonIfExists(DEPLOYMENTS_FILE);
    const addresses = getAddressesToCheck(current);

    if (addresses.length > 0) {
      const valid = await hasCodeAtAllAddresses(provider, addresses);
      if (valid) {
        console.log("[ok] Existing local deployment detected. Skip redeploy.");
        syncFrontendDeploymentsIfNeeded();
        return;
      }
      console.log("[warn] Deployment file exists but contracts are missing on current chain.");
    }
  } else {
    console.log("[warn] FORCE_REDEPLOY is enabled. A fresh deployment will be executed.");
  }

  console.log("[step] Deploying local contracts...");
  await runDeployScript();

  const deployed = readJsonIfExists(DEPLOYMENTS_FILE);
  const deployedAddresses = getAddressesToCheck(deployed);
  if (deployedAddresses.length === 0) {
    throw new Error("Deployment file is missing required addresses after deploy.");
  }

  const verifyOk = await hasCodeAtAllAddresses(provider, deployedAddresses);
  if (!verifyOk) {
    throw new Error("Deployment verification failed: missing contract code after deploy.");
  }

  syncFrontendDeploymentsIfNeeded();
  console.log("[ok] Local deployment is ready.");
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
