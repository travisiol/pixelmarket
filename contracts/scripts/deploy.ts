import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import { DETERMINISTIC_DEPLOYER, MARKET_SALT, marketConstructorArgs, marketDeployTx, marketInitCodeHash, predictedMarket } from "../../src/lib/marketDeploy";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/**
 * Puts the market on the chain at its deterministic address — the same
 * one the site computes and the same one the /deploy page uses — through
 * Arachnid's deterministic-deployment proxy (CREATE2). Anyone can run it;
 * the deployer pays gas and gets nothing else: the contract has no owner.
 *
 *   npm run deploy:robinhood   (DEPLOYER_PRIVATE_KEY in contracts/.env)
 *
 * If the code is already there, nothing is sent and the record is written
 * anyway. The init code comes from src/lib/abi/PixelMarket.bytecode.json
 * (exported by `hardhat compile`) plus the Pons factory address, so the
 * address cannot drift from the site.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY in contracts/.env");
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [factory] = marketConstructorArgs();
  const expected = predictedMarket();
  console.log(`network ${network.name} chainId ${chainId} deployer ${deployer.address}`);
  console.log(`factory ${factory}`);
  console.log(`deterministic deployer ${DETERMINISTIC_DEPLOYER} salt ${MARKET_SALT}`);
  console.log(`init code hash ${marketInitCodeHash()} → market ${expected}`);

  if ((await ethers.provider.getCode(factory)) === "0x") throw new Error(`no code at the Pons factory ${factory} on chain ${chainId}`);
  if ((await ethers.provider.getCode(DETERMINISTIC_DEPLOYER)) === "0x") {
    throw new Error(`no deterministic deployer at ${DETERMINISTIC_DEPLOYER} on chain ${chainId}`);
  }

  let txHash: string | null = null;
  let block: number | null = null;
  if ((await ethers.provider.getCode(expected)) !== "0x") {
    console.log(`already deployed at ${expected} — nothing to send`);
  } else {
    const tx = marketDeployTx();
    const sent = await deployer.sendTransaction({ to: tx.to, data: tx.data });
    console.log(`sent ${sent.hash}, waiting…`);
    const receipt = await sent.wait();
    if (!receipt || receipt.status !== 1) throw new Error("deployment reverted");
    txHash = sent.hash;
    block = receipt.blockNumber;
    console.log(`mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
    if ((await ethers.provider.getCode(expected)) === "0x") throw new Error(`no code at ${expected} after the transaction`);
  }

  const market = await ethers.getContractAt("PixelMarket", expected);
  const onChainFactory: string = await market.factory();
  if (onChainFactory.toLowerCase() !== factory.toLowerCase()) {
    throw new Error(`the contract at ${expected} points at another factory (${onChainFactory})`);
  }
  console.log(`PixelMarket at ${expected}: factory matches, ${await market.parcelCount()} parcels so far`);

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    ponsFactory: factory,
    forwarder: await market.forwarder(),
    market: expected,
    deployedAt: new Date().toISOString(),
    txHash,
    block,
  };
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const file = path.join(deploymentsDir, `${network.name === "hardhat" ? "local" : network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
