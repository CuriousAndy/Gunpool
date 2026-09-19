import hre from "hardhat";

async function main() {
  const conn = await hre.network.connect();
  console.log("✅ got network connection");
  console.log("viem exists?", !!(conn as any).viem);

  const { viem } = conn as any;
  const publicClient = await viem.getPublicClient();
  console.log("block:", await publicClient.getBlockNumber());

  const [w] = await viem.getWalletClients();
  console.log("wallet:", w.account.address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
