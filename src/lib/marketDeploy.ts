import { concatHex, encodeDeployData, getContractAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { pixelMarketAbi } from "./abi/pixelMarketAbi";
import bytecodeRecord from "./abi/PixelMarket.bytecode.json";
import { MARKET_OVERRIDE, PONS_FACTORY } from "./contracts";
import { site } from "./site";

/**
 * The market's address is known before it exists.
 *
 * It is created with CREATE2 through Arachnid's deterministic-deployment
 * proxy (0x4e59…956C, present on Robinhood Chain), from the exact creation
 * bytecode hardhat exported next to the ABI plus its one constructor
 * argument (the Pons factory). Same inputs, same address, whoever sends
 * the transaction — so anyone with a wallet can put it on the chain, the
 * site reads it there, and nobody holds a key for it. A recompiled
 * contract is a different address, never a silent swap.
 */
export const DETERMINISTIC_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/** Runtime code of the proxy, as read from Robinhood Chain (69 bytes). */
export const DETERMINISTIC_DEPLOYER_CODE: Hex =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

/** Salt for the CREATE2; bump the suffix to get a fresh address on purpose. */
export const MARKET_SALT: Hex = keccak256(stringToHex(`${site.slug}:market:v1`));

export const MARKET_BYTECODE = bytecodeRecord.bytecode as Hex;

/** `factory` is only ever overridden by tests, which run against a Pons mock. */
export function marketConstructorArgs(factory: Address = PONS_FACTORY): readonly [Address] {
  return [factory];
}

/** Creation bytecode with the constructor argument appended. */
export function marketInitCode(factory: Address = PONS_FACTORY): Hex {
  const [f] = marketConstructorArgs(factory);
  return encodeDeployData({ abi: pixelMarketAbi, bytecode: MARKET_BYTECODE, args: [f] });
}

export function marketInitCodeHash(factory: Address = PONS_FACTORY): Hex {
  return keccak256(marketInitCode(factory));
}

/** Where the market lives (or will live) on any chain that has the proxy. */
export function predictedMarket(factory: Address = PONS_FACTORY): Address {
  return getContractAddress({ opcode: "CREATE2", from: DETERMINISTIC_DEPLOYER, salt: MARKET_SALT, bytecode: marketInitCode(factory) });
}

/** The market the site reads: the override when set, otherwise the predicted address. */
export const MARKET: Address = MARKET_OVERRIDE ?? predictedMarket();

/** The one transaction that deploys it: `to` the proxy, `data` = salt ‖ init code. */
export function marketDeployTx(factory: Address = PONS_FACTORY): { to: Address; data: Hex } {
  return { to: DETERMINISTIC_DEPLOYER, data: concatHex([MARKET_SALT, marketInitCode(factory)]) };
}
