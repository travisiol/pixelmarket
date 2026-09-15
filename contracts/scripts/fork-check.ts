import { ethers, network } from "hardhat";
import { DETERMINISTIC_DEPLOYER, marketDeployTx, marketInitCodeHash, predictedMarket } from "../../src/lib/marketDeploy";

/**
 * Exercises PixelMarket against the REAL Pons V2 factory on an in-process
 * fork of Robinhood Chain. Nothing is broadcast.
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check
 *
 * What it proves, in order:
 *   1. the market lands at its predicted address when sent through the
 *      deterministic deployer that lives on the chain (CREATE2), and a
 *      second attempt reverts;
 *   2. a launch with a first buy goes through Pons' forwarder in one
 *      transaction: parcel #0 is recorded, the caller is the curve's
 *      deployer (creator-fee recipient) and got the tokens, the fill
 *      matches the local constant-product quote to the wei, the market
 *      holds nothing;
 *   3. a launch with no first buy goes straight through the factory and
 *      opens an empty curve;
 *   4. the same creator can launch again (every launch has its own salt);
 *   5. a wrong value and an empty name revert before anything is sent;
 *   6. buys and sells on the curve from a stranger match the local quote,
 *      and the CurveBuy / CurveSell logs — read the way the city reads
 *      them, one address-filtered getLogs — add up to the traded volume.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const NO_SOCIALS: [string, string, string, string, string] = ["", "", "", "", ""];

const CURVE_ABI = [
  "function getReserves() view returns (uint256,uint256)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function launchSupply() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function deployer() view returns (address)",
  "function token() view returns (address)",
  "function pairToken() view returns (address)",
  "function snipeTaxExempt(address) view returns (bool)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function sell(uint256,uint256,address) returns (uint256)",
  "event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax)",
  "event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
];
const FACTORY_ABI = [
  "function launchFee() view returns (uint256)",
  "function launchForwarder() view returns (address)",
  "function feeEscrow() view returns (address)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 configId, uint256 graduationThreshold)",
];

const fmt = (v: bigint, d = 18) => ethers.formatUnits(v, d);

/** Local quote — the same maths as src/lib/curvemath.ts. */
function quoteBuy(quoteReserve: bigint, tokenReserve: bigint, amountIn: bigint, feeBps: bigint) {
  const net = amountIn - (amountIn * feeBps) / 10_000n;
  return (tokenReserve * net) / (quoteReserve + net);
}
function quoteSell(quoteReserve: bigint, tokenReserve: bigint, tokensIn: bigint, feeBps: bigint) {
  const gross = (quoteReserve * tokensIn) / (tokenReserve + tokensIn);
  return gross - (gross * feeBps) / 10_000n;
}

function findEvent(iface: ethers.Interface, logs: readonly { topics: readonly string[]; data: string; address: string }[], name: string) {
  for (const l of logs) {
    try {
      const p = iface.parseLog({ topics: [...l.topics], data: l.data });
      if (p?.name === name) return p;
    } catch {
      /* not ours */
    }
  }
  return null;
}

async function revertOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "NO REVERT";
  } catch (e) {
    const err = e as { data?: string; message: string; shortMessage?: string };
    return (err.shortMessage ?? err.message).replace(/\s+/g, " ").slice(0, 200);
  }
}

async function main() {
  const [deployer, alice, bob, stranger] = await ethers.getSigners();
  // EDR refuses eth_call at the fork block itself on a chain it does not
  // know; one local block and everything executes under our hardfork.
  await network.provider.send("evm_mine", []);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const block = await ethers.provider.getBlockNumber();
  console.log(`network ${network.name} chainId ${chainId} block ${block}`);
  if ((await ethers.provider.getCode(PONS_FACTORY)) === "0x") {
    throw new Error("Not a Robinhood Chain fork: no factory code at " + PONS_FACTORY + " — set FORK_URL");
  }
  const factory = new ethers.Contract(PONS_FACTORY, FACTORY_ABI, ethers.provider);
  const forwarderAddr: string = await factory.launchForwarder();
  const fee: bigint = await factory.launchFee();
  console.log("forwarder", forwarderAddr, "feeEscrow", await factory.feeEscrow(), "launchFee", fmt(fee));

  const summary: Record<string, unknown> = { block, launchFee: fmt(fee) };

  // ── 1. Deterministic deployment through the on-chain proxy ───────────
  const expected = predictedMarket();
  console.log(`\n[1] deterministic deployer ${DETERMINISTIC_DEPLOYER} has code: ${(await ethers.provider.getCode(DETERMINISTIC_DEPLOYER)) !== "0x"}`);
  console.log(`  init code hash ${marketInitCodeHash()} → predicted ${expected}; code there before: ${(await ethers.provider.getCode(expected)) !== "0x"}`);
  const dtx = marketDeployTx();
  const dr = await (await deployer.sendTransaction({ to: dtx.to, data: dtx.data })).wait();
  const landed = (await ethers.provider.getCode(expected)) !== "0x";
  console.log(`  deployed through the proxy: gas ${dr!.gasUsed}, code at the predicted address: ${landed ? "YES" : "NO"}`);
  if (!landed) throw new Error("the market did not land at the predicted address");
  const secondDeploy = await revertOf(deployer.sendTransaction({ to: dtx.to, data: dtx.data }));
  console.log("  a second deployment with the same salt and code:", secondDeploy);
  summary.deterministic = { deployer: DETERMINISTIC_DEPLOYER, market: expected, gas: dr!.gasUsed.toString(), secondAttempt: secondDeploy };

  const market = await ethers.getContractAt("PixelMarket", expected);
  if ((await market.forwarder()).toLowerCase() !== forwarderAddr.toLowerCase()) throw new Error("forwarder mismatch");

  // ── 2. Launch with a first buy, through the forwarder ────────────────
  console.log("\n[2] launch with a first buy");
  const buy = ethers.parseEther("0.01");
  const tx = await market.connect(alice).launch("Pixel Coin", "PXL", "ipfs://bafkreipixelmarketpxl", "the first building in the city.", NO_SOCIALS, 0, 0, buy, 0, { value: fee + buy });
  const receipt = await tx.wait();
  const built = findEvent(market.interface, receipt!.logs, "ParcelBuilt");
  if (!built) throw new Error("no ParcelBuilt");
  const [parcelId, token, creator, curveAddr] = built.args as unknown as [bigint, string, string, string];
  const launchedEv = findEvent(new ethers.Interface(FACTORY_ABI), receipt!.logs, "TokenLaunched");
  const buyEv = findEvent(new ethers.Interface(CURVE_ABI), receipt!.logs, "CurveBuy");
  console.log(`  parcel #${parcelId} gas ${receipt!.gasUsed} token ${token} curve ${curveAddr} creator ${creator}`);
  console.log(`  factory TokenLaunched: deployer ${launchedEv?.args[2]} pair ${launchedEv?.args[3]} threshold ${fmt(launchedEv?.args[5] ?? 0n)}`);
  const erc = new ethers.Contract(token, ERC20_ABI, ethers.provider);
  const curve = new ethers.Contract(curveAddr, CURVE_ABI, ethers.provider);
  const [q0, t0] = [1_680_000_000_000_000_000n, await curve.launchSupply()];
  const expectedOut = quoteBuy(q0, t0, buy, await curve.feeBps());
  const aliceBal: bigint = await erc.balanceOf(alice.address);
  console.log(`  token "${await erc.name()}" ${await erc.symbol()} | alice balance ${fmt(aliceBal)} | CurveBuy tokensOut ${fmt(buyEv?.args[3] ?? 0n)} fee ${fmt(buyEv?.args[4] ?? 0n)} snipe ${buyEv?.args[5]}`);
  console.log(`  local quote for 0.01 ETH on a fresh curve: ${fmt(expectedOut)} → ${aliceBal === expectedOut ? "EXACT MATCH" : "DIFFERS"}`);
  console.log(`  curve.deployer() ${await curve.deployer()} == alice ${(await curve.deployer()) === alice.address}`);
  console.log(`  snipe-tax exempt: alice ${await curve.snipeTaxExempt(alice.address)} market ${await curve.snipeTaxExempt(expected)} | bob currentSnipeTaxBps ${await curve.currentSnipeTaxBps(bob.address)}`);
  console.log(`  market holds ${fmt(await ethers.provider.getBalance(expected))} ETH and ${fmt(await erc.balanceOf(expected))} tokens`);
  if ((await curve.deployer()) !== alice.address) throw new Error("creator fee recipient is not the caller");
  if (aliceBal === 0n) throw new Error("buy did not land with the caller");
  const p0 = await market.parcels(0);
  if (p0.token !== token || p0.creator !== alice.address || p0.curve !== curveAddr) throw new Error("parcel not recorded");
  console.log(`  parcels(0): "${p0.name}" $${p0.symbol} logo ${p0.logo} launchBlock ${p0.launchBlock} launchedAt ${p0.launchedAt}`);
  summary.launchWithBuy = { gas: receipt!.gasUsed.toString(), token, curve: curveAddr, tokensOut: fmt(aliceBal), quoteMatches: aliceBal === expectedOut };

  // ── 3. Launch with no first buy, straight through the factory ────────
  console.log("\n[3] launch without a first buy");
  const tx3 = await market.connect(bob).launch("Empty Lot", "LOT", "", "nobody bought yet.", NO_SOCIALS, 0, 0, 0, 0, { value: fee });
  const r3 = await tx3.wait();
  const built3 = findEvent(market.interface, r3!.logs, "ParcelBuilt");
  const [id3, token3, , curve3Addr] = built3!.args as unknown as [bigint, string, string, string];
  const curve3 = new ethers.Contract(curve3Addr, CURVE_ABI, ethers.provider);
  const [q3, t3] = await curve3.getReserves();
  console.log(`  parcel #${id3} gas ${r3!.gasUsed} token ${token3} curve ${curve3Addr} | reserves ${fmt(q3)} / ${fmt(t3)} real ${fmt(await curve3.realQuoteReserve())} | deployer == bob ${(await curve3.deployer()) === bob.address}`);
  if ((await curve3.deployer()) !== bob.address) throw new Error("direct launch: creator fee recipient is not the caller");
  if ((await curve3.realQuoteReserve()) !== 0n) throw new Error("direct launch: curve is not empty");
  summary.launchNoBuy = { gas: r3!.gasUsed.toString(), token: token3, curve: curve3Addr };

  // ── 4. Same creator, again ───────────────────────────────────────────
  console.log("\n[4] alice launches a second token");
  const tx4 = await market.connect(alice).launch("Pixel Coin Two", "PXL2", "", "", NO_SOCIALS, 100, 0, buy, 0, { value: fee + buy });
  const r4 = await tx4.wait();
  const built4 = findEvent(market.interface, r4!.logs, "ParcelBuilt");
  const [id4, token4, , curve4Addr] = built4!.args as unknown as [bigint, string, string, string];
  const curve4 = new ethers.Contract(curve4Addr, CURVE_ABI, ethers.provider);
  console.log(`  parcel #${id4} token ${token4} (≠ first: ${token4 !== token}) creatorTaxBps ${await curve4.creatorTaxBps()} gas ${r4!.gasUsed}`);
  const [ex4, pid4] = await market.parcelOf(token4);
  console.log(`  parcelOf(token) → ${ex4} #${pid4} | parcelCount ${await market.parcelCount()}`);
  summary.secondLaunch = { parcelId: id4.toString(), token: token4, tax: (await curve4.creatorTaxBps()).toString() };

  // ── 5. Reverts ───────────────────────────────────────────────────────
  console.log("\n[5] reverts");
  const wrong = await revertOf(market.connect(stranger).launch.staticCall("X", "X", "", "", NO_SOCIALS, 0, 0, buy, 0, { value: fee }));
  console.log("  wrong value:", wrong);
  const empty = await revertOf(market.connect(stranger).launch.staticCall("", "X", "", "", NO_SOCIALS, 0, 0, 0, 0, { value: fee }));
  console.log("  empty name:", empty);
  summary.reverts = { wrongValue: wrong, emptyName: empty };

  // ── 6. Trades from a stranger, and the logs the city reads ───────────
  console.log("\n[6] trades");
  const spend = ethers.parseEther("0.05");
  const [qa, ta] = await curve.getReserves();
  const localBuy = quoteBuy(qa, ta, spend, await curve.feeBps());
  const rb = await (await curve.connect(stranger).buy(spend, 0, stranger.address, { value: spend })).wait();
  const got: bigint = await erc.balanceOf(stranger.address);
  const bEv = findEvent(new ethers.Interface(CURVE_ABI), rb!.logs, "CurveBuy");
  console.log(`  PXL buy 0.05 ETH: got ${fmt(got)} | local quote ${fmt(localBuy)} → ${got === localBuy ? "EXACT" : "DIFFERS"} | snipeTax ${bEv?.args[5]} | gas ${rb!.gasUsed}`);
  const half = got / 2n;
  const [qb, tb] = await curve.getReserves();
  const localSell = quoteSell(qb, tb, half, await curve.feeBps());
  await (await erc.connect(stranger).approve(curveAddr, half)).wait();
  const rs = await (await curve.connect(stranger).sell(half, 0, stranger.address)).wait();
  const sEv = findEvent(new ethers.Interface(CURVE_ABI), rs!.logs, "CurveSell");
  console.log(`  PXL sell ${fmt(half)}: CurveSell quoteOut ${fmt(sEv?.args[3] ?? 0n)} | local quote ${fmt(localSell)} → ${(sEv?.args[3] ?? 0n) === localSell ? "EXACT" : "DIFFERS"}`);
  console.log(`  PXL curve quoteFeeBalance ${fmt(await curve.quoteFeeBalance())} ETH (creator share accrues for ${await curve.deployer()})`);

  // The city's activity read: one getLogs over several curves, both events.
  const iface = new ethers.Interface(CURVE_ABI);
  const topics = [[iface.getEvent("CurveBuy")!.topicHash, iface.getEvent("CurveSell")!.topicHash]];
  const logs = await ethers.provider.getLogs({ address: [curveAddr, curve3Addr, curve4Addr], topics, fromBlock: Number(p0.launchBlock), toBlock: "latest" });
  let volume = 0n;
  let trades = 0;
  const perCurve: Record<string, { volume: bigint; trades: number }> = {};
  for (const l of logs) {
    const parsed = iface.parseLog({ topics: [...l.topics], data: l.data });
    if (!parsed) continue;
    const v: bigint = parsed.name === "CurveBuy" ? parsed.args[2] : parsed.args[3];
    volume += v;
    trades++;
    const k = l.address.toLowerCase();
    perCurve[k] = perCurve[k] ?? { volume: 0n, trades: 0 };
    perCurve[k].volume += v;
    perCurve[k].trades++;
  }
  const expectedVolume = buy + spend + (sEv?.args[3] ?? 0n) + buy;
  console.log(`  getLogs over 3 curves: ${logs.length} logs, ${trades} trades, volume ${fmt(volume)} ETH | expected ${fmt(expectedVolume)} → ${volume === expectedVolume ? "EXACT" : "DIFFERS"}`);
  for (const [k, v] of Object.entries(perCurve)) console.log(`    ${k}: ${v.trades} trades, ${fmt(v.volume)} ETH`);
  summary.trades = { buyExact: got === localBuy, sellExact: (sEv?.args[3] ?? 0n) === localSell, logs: logs.length, volume: fmt(volume), volumeExact: volume === expectedVolume };

  console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
