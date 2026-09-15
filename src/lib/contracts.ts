import { isAddress, type Address } from "viem";

/** Pons V2 on Robinhood Chain — verified on a fork, see README. */
export const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
export const PONS_FORWARDER: Address = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const PONS_FEE_ESCROW: Address = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";

const raw = process.env.NEXT_PUBLIC_MARKET?.trim() ?? "";

/**
 * Optional override of the market's address. Normally unset: the address
 * is deterministic (see marketDeploy.ts) and the site reads whether the
 * contract exists at it. Set it only to point the site at another
 * deployment on purpose — a rehearsal against the Pons mock, say.
 */
export const MARKET_OVERRIDE: Address | undefined = isAddress(raw) ? (raw as Address) : undefined;

/** Pons launch fee, display only; the market reads the live value. */
export const LAUNCH_FEE_ETH_DISPLAY = process.env.NEXT_PUBLIC_LAUNCH_FEE_ETH ?? "0.0005";

/** Pons launch config for every pair today. */
export const LAUNCH_CONFIG_ID = 0n;

/**
 * Where log scans start when a parcel has no launch block of its own:
 * NEXT_PUBLIC_MARKET_BLOCK when set, else 0. The public RPC answers an
 * address-filtered getLogs over the whole chain.
 */
export const MARKET_BLOCK = BigInt(process.env.NEXT_PUBLIC_MARKET_BLOCK ?? "0");
