import * as http from "http";
import { ethers, network } from "hardhat";
import { DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE, marketDeployTx, predictedMarket } from "../../src/lib/marketDeploy";

/**
 * Front-end rehearsal without a live deployment: a network the site can be
 * pointed at (NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8686), with a small city
 * already built on it.
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com HARDHAT_CHAIN_ID=4663 npm run serve:fork
 *     — a fork of Robinhood Chain, in-process, against the REAL Pons factory.
 *       The market is deployed the way the site does it (deterministic
 *       address), so nothing needs configuring. The public RPC only keeps
 *       recent state and a fork dies after a few minutes: seed, look, done.
 *
 *   HARDHAT_CHAIN_ID=4663 npm run serve:fork
 *     — no FORK_URL: the Pons MOCK from the unit tests on a plain hardhat
 *       network (with the real Multicall3 bytecode copied in), same seeding,
 *       no clock. The mock factory has its own address, so the market's
 *       address differs from the deterministic one: the script prints the
 *       NEXT_PUBLIC_MARKET override to set.
 *
 * SEED=none serves an empty network (the browser gets to deploy and launch).
 * Test wallet: hardhat account #1 (alice) — unlocked, so the browser stub
 * (public/dev-wallet.js) can send from it without a key.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const PORT = Number(process.env.PORT ?? 8686);
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
  "function protocolFeeShareBps() view returns (uint256)",
  "function deployer() view returns (address)",
  "function token() view returns (address)",
  "function pairToken() view returns (address)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function sell(uint256,uint256,address) returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const FACTORY_ABI = ["function launchFee() view returns (uint256)", "function feeEscrow() view returns (address)"];
const ESCROW_ABI = ["function balanceOf(address) view returns (uint256)"];

function serve() {
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const handle = async (call: { id?: unknown; method: string; params?: unknown[] }) => {
        const started = Date.now();
        if (process.env.RPC_LOG) console.log(`→ ${call.method} ${JSON.stringify(call.params ?? []).slice(0, 160)}`);
        try {
          const result = await network.provider.request({ method: call.method, params: call.params ?? [] });
          if (process.env.RPC_LOG) console.log(`← ${call.method} ${Date.now() - started} ms`);
          return { jsonrpc: "2.0", id: call.id ?? null, result };
        } catch (e) {
          const err = e as { code?: number; message?: string; data?: unknown };
          return { jsonrpc: "2.0", id: call.id ?? null, error: { code: typeof err.code === "number" ? err.code : -32000, message: err.message ?? "error", data: err.data } };
        }
      };
      const out = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload as { method: string });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(PORT, () => console.log(`serving on http://127.0.0.1:${PORT} — Ctrl+C to stop`));
}

/** The seed city: one parcel per building tier, plus a few small ones. */
type Seed = { name: string; symbol: string; logo: string; description: string; firstBuy: string; buys: string[]; sellFrac?: number; tax?: number };
const SEEDS: Seed[] = [
  { name: "Pixel Coin", symbol: "PXL", logo: "", description: "the first building in the city.", firstBuy: "0.02", buys: ["0.03", "0.02"] },
  { name: "Empty Lot", symbol: "LOT", logo: "", description: "launched, nobody bought yet.", firstBuy: "0", buys: [] },
  { name: "Shack Token", symbol: "SHK", logo: "", description: "one floor, a door, a window.", firstBuy: "0.012", buys: [] },
  { name: "House Money", symbol: "HUT", logo: "", description: "a roof over your bags.", firstBuy: "0.03", buys: ["0.03"], sellFrac: 0.3 },
  { name: "Corner Shop", symbol: "SHP", logo: "", description: "open all night.", firstBuy: "0.05", buys: ["0.1", "0.08"], sellFrac: 0.25 },
  { name: "Tower Inc", symbol: "TWR", logo: "", description: "eight floors of pure vibes.", firstBuy: "0.1", buys: ["0.2", "0.25", "0.15"], sellFrac: 0.2 },
  { name: "Highrise", symbol: "HIR", logo: "", description: "you can see the plaza from up here.", firstBuy: "0.3", buys: ["0.5", "0.4", "0.3"], sellFrac: 0.2 },
  { name: "Skyline", symbol: "SKY", logo: "", description: "the tallest thing on the block, for now.", firstBuy: "0.5", buys: ["1", "0.8", "0.7", "0.5"], sellFrac: 0.15 },
  { name: "Landmark", symbol: "MARK", logo: "", description: "graduated. gold on the roof.", firstBuy: "1", buys: ["1.2", "1.1", "1"], tax: 0 },
  { name: "Green Block", symbol: "GRN", logo: "", description: "small and steady.", firstBuy: "0.015", buys: ["0.01"] },
  { name: "Blue Block", symbol: "BLU", logo: "", description: "a house with a blue door.", firstBuy: "0.04", buys: ["0.02", "0.02"] },
  { name: "Night Market", symbol: "NITE", logo: "", description: "trades while you sleep.", firstBuy: "0.2", buys: ["0.3", "0.2"], sellFrac: 0.4 },
];

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, alice, bob, stranger, whale] = signers;
  await network.provider.send("evm_mine", []);
  const forked = (await ethers.provider.getCode(PONS_FACTORY)) !== "0x";
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  let factoryAddr = PONS_FACTORY;
  if (!forked) {
    if (process.env.FORK_URL) throw new Error("FORK_URL is set but there is no factory code — not a Robinhood Chain fork");
    const mock = await (await ethers.getContractFactory("MockPonsFactory")).deploy(deployer.address);
    await mock.waitForDeployment();
    factoryAddr = await mock.getAddress();
    console.log(`mock pons factory ${factoryAddr} (no FORK_URL: rehearsal on the mock, not the real factory)`);
    await network.provider.send("hardhat_setCode", [DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE]);
    try {
      const res = await fetch("https://rpc.mainnet.chain.robinhood.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [MULTICALL3, "latest"] }),
      });
      const j = (await res.json()) as { result?: string };
      if (j.result && j.result !== "0x") {
        await network.provider.send("hardhat_setCode", [MULTICALL3, j.result]);
        console.log("multicall3 bytecode copied from robinhood chain");
      }
    } catch {
      console.log("warning: could not fetch Multicall3 bytecode; batched reads will fall back");
    }
  }

  const marketAddr = predictedMarket(factoryAddr as `0x${string}`);

  if (process.env.SEED === "none") {
    console.log(`chainId ${chainId} block ${await ethers.provider.getBlockNumber()} — nothing deployed; the market would live at ${marketAddr}`);
    console.log(`NEXT_PUBLIC_RPC_URL=http://127.0.0.1:${PORT}`);
    if (!forked) console.log(`NEXT_PUBLIC_MARKET=${marketAddr}`);
    console.log(`test wallet (unlocked): ${alice.address}`);
    serve();
    await new Promise(() => {});
    return;
  }

  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, ethers.provider);
  const fee: bigint = await factory.launchFee();
  const escrow = new ethers.Contract(await factory.feeEscrow(), ESCROW_ABI, ethers.provider);

  // The way the site deploys it: one transaction to the deterministic deployer.
  const dtx = marketDeployTx(factoryAddr as `0x${string}`);
  await (await alice.sendTransaction({ to: dtx.to, data: dtx.data })).wait();
  const market = await ethers.getContractAt("PixelMarket", marketAddr);
  console.log(`chainId ${chainId} block ${await ethers.provider.getBlockNumber()} market ${marketAddr} (deterministic, deployed by ${alice.address})`);

  const creators = [alice, bob, stranger, whale, signers[5], signers[6]];
  const traders = [whale, signers[7], signers[8], signers[9], bob, stranger];
  console.log("seeding:");
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i];
    const creator = creators[i % creators.length];
    const first = ethers.parseEther(s.firstBuy);
    const tx = await market.connect(creator).launch(s.name, s.symbol, s.logo, s.description, NO_SOCIALS, s.tax ?? 0, 0, first, 0, { value: fee + first });
    await tx.wait();
    const p = await market.parcels(i);
    const curve = new ethers.Contract(p.curve, CURVE_ABI, ethers.provider);
    const token = new ethers.Contract(p.token, ERC20_ABI, ethers.provider);
    let j = 0;
    for (const amt of s.buys) {
      const who = traders[(i + j++) % traders.length];
      const v = ethers.parseEther(amt);
      if (await curve.graduated()) break;
      await (await curve.connect(who).buy(v, 0, who.address, { value: v })).wait();
    }
    if (s.sellFrac && !(await curve.graduated())) {
      const who = traders[i % traders.length];
      const bal: bigint = await token.balanceOf(who.address);
      const part = (bal * BigInt(Math.round(s.sellFrac * 1000))) / 1000n;
      if (part > 0n) {
        await (await token.connect(who).approve(p.curve, part)).wait();
        await (await curve.connect(who).sell(part, 0, who.address)).wait();
      }
    }
    console.log(`  #${i} $${s.symbol} by ${creator.address.slice(0, 8)} — real ${ethers.formatEther(await curve.realQuoteReserve())} ETH, graduated ${await curve.graduated()}`);
  }

  // Warm every slot the site reads, so a forked network answers from cache.
  const all = await market.snapshot(0, 100);
  for (const e of all) {
    const curve = new ethers.Contract(e.parcel.curve, CURVE_ABI, ethers.provider);
    const token = new ethers.Contract(e.parcel.token, ERC20_ABI, ethers.provider);
    await Promise.all([
      curve.getReserves(),
      curve.realQuoteReserve(),
      curve.graduationThreshold(),
      curve.graduated(),
      curve.launchSupply(),
      curve.feeBps(),
      curve.creatorTaxBps(),
      curve.quoteFeeBalance(),
      curve.pairToken(),
      curve.protocolFeeShareBps().catch(() => 0n),
      curve.currentSnipeTaxBps(alice.address).catch(() => 0n),
      token.totalSupply(),
      token.balanceOf(alice.address),
      escrow.balanceOf(e.parcel.creator).catch(() => 0n),
    ]);
  }
  await escrow.balanceOf(alice.address).catch(() => 0n);
  await ethers.provider.getBalance(alice.address);

  console.log(`\n${all.length} parcels built. NEXT_PUBLIC_RPC_URL=http://127.0.0.1:${PORT}`);
  if (!forked) console.log(`NEXT_PUBLIC_MARKET=${marketAddr}`);
  console.log(`test wallet (unlocked): ${alice.address}`);
  serve();
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
