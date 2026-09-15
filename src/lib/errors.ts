import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Pons' own custom errors, by selector (named via openchain, checked on a fork). */
const PONS_ERRORS: Record<string, string> = {
  "0x1f2a2005": "pons refused a zero first buy (ZeroAmount).",
  "0x49285dfb": "pons does not accept this pair token (PairTokenNotApproved).",
  "0x8d42130c": "only pons can sweep fees.",
  "0xfb8f41b2": "the curve needs an approval first.",
};

const OURS: Record<string, string> = {
  EmptyName: "the token needs a name.",
  EmptySymbol: "the token needs a ticker.",
  TooLong: "one of the fields is too long for the chain.",
  WrongValue: "wrong eth amount for this launch — reload and try again.",
  UnknownParcel: "no such parcel.",
  NativeValueMismatch: "the eth sent did not match the amount.",
};

/** One short, lowercase sentence for whatever the wallet or the chain threw. */
export function explainError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "you cancelled in your wallet.";
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName;
      if (name && OURS[name]) return OURS[name];
      const sig = reverted.signature ?? (reverted.raw ? reverted.raw.slice(0, 10) : undefined);
      if (sig && PONS_ERRORS[sig]) return PONS_ERRORS[sig];
      if (name) return `reverted: ${name}.`;
      if (sig) return `reverted with ${sig}.`;
    }
    const msg = e.shortMessage || e.message;
    for (const [sel, text] of Object.entries(PONS_ERRORS)) if (msg.includes(sel)) return text;
    for (const [name, text] of Object.entries(OURS)) if (msg.includes(name)) return text;
    if (/insufficient funds/i.test(msg)) return "not enough eth for this, gas included.";
    return msg.split("\n")[0].toLowerCase();
  }
  if (e instanceof Error) return e.message.split("\n")[0].toLowerCase();
  return "something went wrong.";
}
