import { ethers } from "ethers";
import fs from "fs";
import path from "path";

const RPC_URL = "http://127.0.0.1:8545";
const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log("Deployer:", deployer.address);

  const artifactPath = path.resolve(
    "artifacts/contracts/MockERC20.sol/MockERC20.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const Factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer
  );

  let nonce = await provider.getTransactionCount(deployer.address, "pending");

  const usdc = await Factory.deploy("Mock USDC", "mUSDC", 6, { nonce });
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("mUSDC deployed at:", usdcAddr);
  nonce++;

  const dai = await Factory.deploy("Mock DAI", "mDAI", 18, { nonce });
  await dai.waitForDeployment();
  const daiAddr = await dai.getAddress();
  console.log("mDAI deployed at:", daiAddr);
  nonce++;

  await (await usdc.mint(deployer.address, 10_000n * 10n ** 6n, { nonce })).wait();
  nonce++;

  await (await dai.mint(deployer.address, 10_000n * 10n ** 18n, { nonce })).wait();
  nonce++;

  console.log("Minted tokens to deployer ✅");

  fs.writeFileSync(
    "deployments.local.json",
    JSON.stringify({ MUSDC: usdcAddr, MDAI: daiAddr }, null, 2)
  );
  console.log("Saved deployments.local.json ✅");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
