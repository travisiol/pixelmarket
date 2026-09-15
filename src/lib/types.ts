import type { Address } from "viem";

/** One parcel as the API serves it: chain facts plus the derived level. */
export type ParcelJson = {
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
  /** null when the curve could not be read this round. */
  state: CurveStateJson | null;
  activity: ActivityJson;
  /** Spot in wei per whole token, market cap in wei, graduation progress 0..100. */
  spotWei: string;
  capWei: string;
  progress: number;
  level: { tier: number; floors: number; progress: number };
};

export type CurveStateJson = {
  quoteReserve: string;
  tokenReserve: string;
  realQuote: string;
  threshold: string;
  graduated: boolean;
  launchSupply: string;
  feeBps: number;
  creatorTaxBps: number;
  quoteFeeBalance: string;
  protocolFeeShareBps: number;
};

export type ActivityJson = {
  /** Sum of every buy's quoteIn and every sell's quoteOut, in wei and in ETH. */
  volumeWei: string;
  volume: number;
  trades: number;
  buys: number;
  sells: number;
  /** Distinct trading wallets seen in the logs. */
  traders: number;
  /** Block of the last trade, 0 when none. */
  lastBlock: number;
};

export type CityJson = {
  /** Code exists at the market's address. */
  deployed: boolean;
  market: Address;
  chainId: number;
  block: number;
  parcels: ParcelJson[];
  totalVolume: number;
  graduated: number;
  ethUsd: number | null;
  readAt: number;
  /** Set when the read failed; parcels then carry the last good state. */
  error?: string;
};

export type TradeJson = {
  kind: "buy" | "sell";
  sender: Address;
  quoteWei: string;
  tokensWei: string;
  block: number;
  tx: string;
  timestamp: number;
};

export type HolderJson = { address: Address; balanceWei: string; share: number };

export type ParcelDetailJson = {
  id: number;
  totalSupplyWei: string;
  /** Creator fees already swept to the Pons escrow for the creator (all their tokens), in wei. */
  escrowWei: string;
  holders: HolderJson[] | null;
  holderCount: number | null;
  trades: TradeJson[] | null;
  readAt: number;
};
