import { createPublicClient, http, parseAbiItem, zeroAddress, type Address, type Hex } from "viem";
import { pixelMarketAbi } from "../abi/pixelMarketAbi";
import { CHAIN_ID, robinhoodChain, RPC_URL } from "../chain";
import { levelOf } from "../city/levels";
import { MARKET_BLOCK, PONS_FEE_ESCROW } from "../contracts";
import { marketCap, spotPerToken } from "../curvemath";
import { MARKET } from "../marketDeploy";
import { curveAbi, erc20Abi, escrowAbi } from "../ponsAbi";
import type { ActivityJson, CityJson, CurveStateJson, HolderJson, ParcelDetailJson, ParcelJson, TradeJson } from "../types";

/**
 * Everything the city shows is read here, from the chain: the market's
 * own register (one paginated call), every curve through Multicall3, and
 * the trading activity from the curves' own CurveBuy / CurveSell logs.
 * No indexer, no Pons API. Nothing is invented: with no market on the
 * chain the city is empty and says so.
 *
 * Runs server-side (the /api/city route) so one read serves every
 * visitor; the log scan is incremental, per curve, kept in memory.
 */
export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL, { batch: true, timeout: 30_000 }),
});

const CURVE_BUY = parseAbiItem("event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax)");
const CURVE_SELL = parseAbiItem("event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Widest block range asked of the RPC in one getLogs; halved on failure. */
const LOG_SPAN = 200_000n;
/** Curves per getLogs call. */
const LOG_ADDRESSES = 25;
const PAGE = 200;

type Accumulator = {
  volume: bigint;
  trades: number;
  buys: number;
  sells: number;
  traders: Set<string>;
  lastBlock: bigint;
  /** Logs are known up to and including this block. */
  scannedTo: bigint;
};

const activity = new Map<string, Accumulator>();
let deployedOnce = false;

export async function isMarketDeployed(): Promise<boolean> {
  if (deployedOnce) return true;
  const code = await publicClient.getCode({ address: MARKET });
  deployedOnce = Boolean(code && code !== "0x");
  return deployedOnce;
}

type Raw = {
  id: number;
  token: Address;
  curve: Address;
  creator: Address;
  launchedAt: number;
  launchBlock: number;
  name: string;
  symbol: string;
  logo: string;
  description: string;
};

async function readRegister(): Promise<Raw[]> {
  const count = Number(await publicClient.readContract({ address: MARKET, abi: pixelMarketAbi, functionName: "parcelCount" }));
  const out: Raw[] = [];
  for (let offset = 0; offset < count; offset += PAGE) {
    const page = await publicClient.readContract({ address: MARKET, abi: pixelMarketAbi, functionName: "snapshot", args: [BigInt(offset), BigInt(PAGE)] });
    for (const e of page) {
      const p = e.parcel;
      out.push({
        id: Number(e.parcelId),
        token: p.token,
        curve: p.curve,
        creator: p.creator,
        launchedAt: Number(p.launchedAt),
        launchBlock: Number(p.launchBlock),
        name: p.name,
        symbol: p.symbol,
        logo: p.logo,
        description: p.description,
      });
    }
  }
  return out;
}

const CURVE_VIEWS = ["getReserves", "realQuoteReserve", "graduationThreshold", "graduated", "launchSupply", "feeBps", "creatorTaxBps", "quoteFeeBalance", "protocolFeeShareBps"] as const;

async function readCurves(parcels: Raw[]): Promise<Map<number, CurveStateJson>> {
  const states = new Map<number, CurveStateJson>();
  const PER = CURVE_VIEWS.length;
  const CHUNK = 40;
  for (let i = 0; i < parcels.length; i += CHUNK) {
    const slice = parcels.slice(i, i + CHUNK);
    const calls = slice.flatMap((p) => CURVE_VIEWS.map((functionName) => ({ address: p.curve, abi: curveAbi, functionName }) as const));
    let results: { status: "success" | "failure"; result?: unknown }[];
    try {
      results = (await publicClient.multicall({ contracts: calls, allowFailure: true })) as { status: "success" | "failure"; result?: unknown }[];
    } catch {
      continue;
    }
    slice.forEach((p, k) => {
      const r = results.slice(k * PER, k * PER + PER);
      if (r.slice(0, 8).some((x) => x.status !== "success")) return;
      const [reserves, realQuote, threshold, graduated, launchSupply, feeBps, creatorTaxBps, quoteFeeBalance] = r.slice(0, 8).map((x) => x.result) as [
        readonly [bigint, bigint],
        bigint,
        bigint,
        boolean,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      const protocolFeeShareBps = r[8].status === "success" ? Number(r[8].result as bigint) : 3000;
      states.set(p.id, {
        quoteReserve: reserves[0].toString(),
        tokenReserve: reserves[1].toString(),
        realQuote: realQuote.toString(),
        threshold: threshold.toString(),
        graduated,
        launchSupply: launchSupply.toString(),
        feeBps: Number(feeBps),
        creatorTaxBps: Number(creatorTaxBps),
        quoteFeeBalance: quoteFeeBalance.toString(),
        protocolFeeShareBps,
      });
    });
  }
  return states;
}

/** One getLogs over many curves and both events, split in two on failure. */
async function scanRange(addresses: Address[], fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (fromBlock > toBlock) return;
  try {
    const logs = await publicClient.getLogs({ address: addresses, events: [CURVE_BUY, CURVE_SELL], fromBlock, toBlock });
    for (const l of logs) {
      const acc = activity.get(l.address.toLowerCase());
      if (!acc) continue;
      const args = l.args as { sender?: Address; recipient?: Address; quoteIn?: bigint; quoteOut?: bigint };
      const v = l.eventName === "CurveBuy" ? (args.quoteIn ?? 0n) : (args.quoteOut ?? 0n);
      acc.volume += v;
      acc.trades++;
      if (l.eventName === "CurveBuy") acc.buys++;
      else acc.sells++;
      // The wallet behind a trade: who received the tokens on a buy (the
      // first buy of a launch is sent by Pons' forwarder), who sold on a sell.
      const who = l.eventName === "CurveBuy" ? (args.recipient ?? args.sender) : args.sender;
      if (who) acc.traders.add(who.toLowerCase());
      if (l.blockNumber > acc.lastBlock) acc.lastBlock = l.blockNumber;
    }
  } catch (e) {
    if (toBlock - fromBlock < 500n) throw e;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    await scanRange(addresses, fromBlock, mid);
    await scanRange(addresses, mid + 1n, toBlock);
  }
}

async function scanActivity(parcels: Raw[], head: bigint): Promise<void> {
  // New curves start from their own launch block; known ones from where they stopped.
  const groups = new Map<string, Address[]>();
  for (const p of parcels) {
    const key = p.curve.toLowerCase();
    let acc = activity.get(key);
    if (!acc) {
      const start = BigInt(p.launchBlock > 0 ? p.launchBlock : Number(MARKET_BLOCK)) - 1n;
      acc = { volume: 0n, trades: 0, buys: 0, sells: 0, traders: new Set(), lastBlock: 0n, scannedTo: start < 0n ? -1n : start };
      activity.set(key, acc);
    }
    if (acc.scannedTo >= head) continue;
    const from = (acc.scannedTo + 1n).toString();
    const list = groups.get(from) ?? [];
    list.push(p.curve);
    groups.set(from, list);
  }
  for (const [fromStr, addresses] of groups) {
    const from = BigInt(fromStr);
    for (let i = 0; i < addresses.length; i += LOG_ADDRESSES) {
      const batch = addresses.slice(i, i + LOG_ADDRESSES);
      let cursor = from;
      try {
        while (cursor <= head) {
          const to = cursor + LOG_SPAN - 1n > head ? head : cursor + LOG_SPAN - 1n;
          await scanRange(batch, cursor, to);
          for (const a of batch) activity.get(a.toLowerCase())!.scannedTo = to;
          cursor = to + 1n;
        }
      } catch {
        // Leave scannedTo where it is; the next read retries from there.
      }
    }
  }
}

function activityOf(curve: Address): ActivityJson {
  const acc = activity.get(curve.toLowerCase());
  if (!acc) return { volumeWei: "0", volume: 0, trades: 0, buys: 0, sells: 0, traders: 0, lastBlock: 0 };
  return {
    volumeWei: acc.volume.toString(),
    volume: Number(acc.volume) / 1e18,
    trades: acc.trades,
    buys: acc.buys,
    sells: acc.sells,
    traders: acc.traders.size,
    lastBlock: Number(acc.lastBlock),
  };
}

let ethUsdCache: { value: number | null; at: number } = { value: null, at: 0 };

/** ETH in USD from Coinbase's public spot endpoint; null when unreachable. */
export async function readEthUsd(): Promise<number | null> {
  if (Date.now() - ethUsdCache.at < 60_000) return ethUsdCache.value;
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { cache: "no-store" });
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    ethUsdCache = { value: Number.isFinite(v) && v > 0 ? v : null, at: Date.now() };
  } catch {
    ethUsdCache = { value: ethUsdCache.value, at: Date.now() };
  }
  return ethUsdCache.value;
}

let lastGood: CityJson | null = null;
let inflight: Promise<CityJson> | null = null;
const TTL_MS = 12_000;

/** The whole city; one in-flight read at a time, served from memory for TTL_MS. */
export function readCity(): Promise<CityJson> {
  if (lastGood && Date.now() - lastGood.readAt < TTL_MS) return Promise.resolve(lastGood);
  if (inflight) return inflight;
  inflight = readCityNow()
    .then((c) => {
      lastGood = c;
      return c;
    })
    .catch((e) => {
      const message = e instanceof Error ? e.message.split("\n")[0] : "read failed";
      if (lastGood) return { ...lastGood, readAt: Date.now(), error: message };
      return { deployed: false, market: MARKET, chainId: CHAIN_ID, block: 0, parcels: [], totalVolume: 0, graduated: 0, ethUsd: null, readAt: Date.now(), error: message };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function readCityNow(): Promise<CityJson> {
  const [deployed, ethUsd] = await Promise.all([isMarketDeployed(), readEthUsd()]);
  if (!deployed) {
    return { deployed: false, market: MARKET, chainId: CHAIN_ID, block: 0, parcels: [], totalVolume: 0, graduated: 0, ethUsd, readAt: Date.now() };
  }
  const head = await publicClient.getBlockNumber();
  const raw = await readRegister();
  const [states] = await Promise.all([readCurves(raw), scanActivity(raw, head)]);
  let totalVolume = 0;
  let graduated = 0;
  const parcels: ParcelJson[] = raw.map((p) => {
    const state = states.get(p.id) ?? null;
    const act = activityOf(p.curve);
    totalVolume += act.volume;
    if (state?.graduated) graduated++;
    const level = levelOf(act.volume, Boolean(state?.graduated));
    const quote = state ? BigInt(state.quoteReserve) : 0n;
    const tokens = state ? BigInt(state.tokenReserve) : 0n;
    const supply = state ? BigInt(state.launchSupply) : 0n;
    const progress = !state ? 0 : state.graduated ? 100 : BigInt(state.threshold) === 0n ? 0 : Math.min(100, Number((BigInt(state.realQuote) * 10_000n) / BigInt(state.threshold)) / 100);
    return {
      ...p,
      state,
      activity: act,
      spotWei: spotPerToken(quote, tokens).toString(),
      capWei: marketCap(quote, tokens, supply).toString(),
      progress,
      level: { tier: level.tier.id, floors: level.floors, progress: level.progress },
    };
  });
  return { deployed: true, market: MARKET, chainId: CHAIN_ID, block: Number(head), parcels, totalVolume, graduated, ethUsd, readAt: Date.now() };
}

/** Holders and trades for one parcel — from logs, degrading to null rather than to a made-up number. */
export async function readParcelDetail(id: number): Promise<ParcelDetailJson | null> {
  const city = await readCity();
  const p = city.parcels.find((x) => x.id === id);
  if (!p) return null;
  const from = BigInt(p.launchBlock > 0 ? p.launchBlock : Number(MARKET_BLOCK));
  const [totalSupply, escrow] = await Promise.all([
    publicClient.readContract({ address: p.token, abi: erc20Abi, functionName: "totalSupply" }).catch(() => 0n),
    publicClient.readContract({ address: PONS_FEE_ESCROW, abi: escrowAbi, functionName: "balanceOf", args: [p.creator] }).catch(() => 0n),
  ]);
  let holders: HolderJson[] | null = null;
  let holderCount: number | null = null;
  let trades: TradeJson[] | null = null;
  try {
    const transfers = await publicClient.getLogs({ address: p.token, event: TRANSFER, fromBlock: from, toBlock: "latest" });
    const balances = new Map<string, bigint>();
    for (const t of transfers) {
      const { from: f, to, value } = t.args as { from: Address; to: Address; value: bigint };
      if (f !== zeroAddress) balances.set(f, (balances.get(f) ?? 0n) - value);
      if (to !== zeroAddress) balances.set(to, (balances.get(to) ?? 0n) + value);
    }
    const list = [...balances.entries()]
      .filter(([a, b]) => b > 0n && a.toLowerCase() !== p.curve.toLowerCase())
      .map(([address, balance]) => ({ address: address as Address, balanceWei: balance.toString(), share: totalSupply === 0n ? 0 : Number((balance * 10_000n) / totalSupply) / 100 }))
      .sort((a, b) => (BigInt(b.balanceWei) > BigInt(a.balanceWei) ? 1 : -1));
    holderCount = list.length;
    holders = list.slice(0, 10);
  } catch {
    holders = null;
  }
  try {
    const logs = await publicClient.getLogs({ address: p.curve, events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: "latest" });
    const raw = logs
      .map((l) => {
        const a = l.args as { sender: Address; recipient?: Address; quoteIn?: bigint; tokensOut?: bigint; tokensIn?: bigint; quoteOut?: bigint };
        return l.eventName === "CurveBuy"
          ? { kind: "buy" as const, sender: a.recipient ?? a.sender, quoteWei: (a.quoteIn ?? 0n).toString(), tokensWei: (a.tokensOut ?? 0n).toString(), block: Number(l.blockNumber), tx: l.transactionHash as Hex }
          : { kind: "sell" as const, sender: a.sender, quoteWei: (a.quoteOut ?? 0n).toString(), tokensWei: (a.tokensIn ?? 0n).toString(), block: Number(l.blockNumber), tx: l.transactionHash as Hex };
      })
      .sort((a, b) => b.block - a.block)
      .slice(0, 20);
    const blocks = [...new Set(raw.map((t) => t.block))];
    const stamps = new Map<number, number>();
    await Promise.all(
      blocks.map(async (b) => {
        try {
          const blk = await publicClient.getBlock({ blockNumber: BigInt(b) });
          stamps.set(b, Number(blk.timestamp));
        } catch {
          stamps.set(b, 0);
        }
      }),
    );
    trades = raw.map((t) => ({ ...t, timestamp: stamps.get(t.block) ?? 0 }));
  } catch {
    trades = null;
  }
  return { id, totalSupplyWei: totalSupply.toString(), escrowWei: escrow.toString(), holders, holderCount, trades, readAt: Date.now() };
}
