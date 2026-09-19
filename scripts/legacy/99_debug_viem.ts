import hre from "hardhat";

async function main() {
  console.log("hre has viem?", "viem" in hre);
  console.log("hre.viem =", (hre as any).viem);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
