import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const GANACHE_CLI = path.resolve(PROJECT_ROOT, "node_modules", "ganache", "dist", "node", "cli.js");
const CHAIN_DB_PATH = path.resolve(PROJECT_ROOT, ".local", "ganache-db");

if (!fs.existsSync(GANACHE_CLI)) {
  console.error("Ganache CLI is missing. Run `npm install` first.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(CHAIN_DB_PATH), { recursive: true });

console.log(`[start] Ganache persistent chain on http://127.0.0.1:8545`);
console.log(`[db] ${CHAIN_DB_PATH}`);

const child = spawn(
  process.execPath,
  [
    GANACHE_CLI,
    "--server.host",
    "127.0.0.1",
    "--server.port",
    "8545",
    "--chain.chainId",
    "31337",
    "--chain.networkId",
    "31337",
    "--wallet.mnemonic",
    "test test test test test test test test test test test junk",
    "--wallet.hdPath",
    "m/44'/60'/0'/0",
    "--wallet.totalAccounts",
    "20",
    "--wallet.defaultBalance",
    "10000",
    "--database.dbPath",
    CHAIN_DB_PATH,
  ],
  {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    shell: false,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

