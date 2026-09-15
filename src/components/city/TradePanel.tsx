"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { zeroAddress, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ConnectButton } from "../ConnectButton";
import { useMounted } from "@/hooks/useCity";
import { CHAIN_ID, explorer } from "@/lib/chain";
import { buyImpactBps, formatUnitsTrim, parseDecimal, quoteBuy, quoteSell, sellImpactBps, withSlippage } from "@/lib/curvemath";
import { explainError } from "@/lib/errors";
import { tokenAmount } from "@/lib/format";
import { curveAbi, erc20Abi } from "@/lib/ponsAbi";
import type { ParcelJson } from "@/lib/types";

const SLIPPAGES = [50n, 100n, 300n] as const;

/**
 * Trade on the curve, from the sheet. buy(quoteAmount, minTokensOut,
 * recipient) with quoteAmount == msg.value; sell(tokensIn, minQuoteOut,
 * recipient) after approving the curve. Quotes are the exact constant
 * product — verified to the wei on a fork — less the snipe tax the curve
 * reports for this wallet.
 */
export function TradePanel({ parcel, balance, ethBalance, onTraded }: { parcel: ParcelJson; balance: bigint; ethBalance: bigint; onTraded: () => void }) {
  const mounted = useMounted();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [raw, setRaw] = useState("");
  const [slippage, setSlippage] = useState<bigint>(100n);
  const [busy, setBusy] = useState<null | "approving" | "sending" | "confirming">(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const state = parcel.state;
  const quoteReserve = state ? BigInt(state.quoteReserve) : 0n;
  const tokenReserve = state ? BigInt(state.tokenReserve) : 0n;
  const feeBps = BigInt(state?.feeBps ?? 100);
  const creatorTaxBps = BigInt(state?.creatorTaxBps ?? 0);
  const graduated = Boolean(state?.graduated);

  const snipe = useReadContract({
    address: parcel.curve,
    abi: curveAbi,
    functionName: "currentSnipeTaxBps",
    args: [address ?? zeroAddress],
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const tokenAllowance = useReadContract({
    address: parcel.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? zeroAddress, parcel.curve],
    query: { enabled: Boolean(address) },
  });

  const amountIn = useMemo(() => parseDecimal(raw) ?? 0n, [raw]);
  const extra = (snipe.data ?? 0n) + creatorTaxBps;
  const out = side === "buy" ? quoteBuy(quoteReserve, tokenReserve, amountIn, feeBps, extra) : quoteSell(quoteReserve, tokenReserve, amountIn, feeBps, extra);
  const minOut = withSlippage(out, slippage);
  const impact = side === "buy" ? buyImpactBps(quoteReserve, tokenReserve, amountIn, out) : sellImpactBps(quoteReserve, tokenReserve, amountIn);
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID;
  const available = side === "buy" ? ethBalance : balance;
  const tooMuch = amountIn > available;

  async function submit() {
    if (!address || !publicClient || amountIn <= 0n) return;
    setError(null);
    setLastTx(null);
    try {
      if (side === "buy") {
        setBusy("sending");
        const hash = await writeContractAsync({ address: parcel.curve, abi: curveAbi, functionName: "buy", args: [amountIn, minOut, address], value: amountIn });
        setBusy("confirming");
        setLastTx(hash);
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        if ((tokenAllowance.data ?? 0n) < amountIn) {
          setBusy("approving");
          const h = await writeContractAsync({ address: parcel.token, abi: erc20Abi, functionName: "approve", args: [parcel.curve, amountIn] });
          await publicClient.waitForTransactionReceipt({ hash: h });
          await tokenAllowance.refetch();
        }
        setBusy("sending");
        const hash = await writeContractAsync({ address: parcel.curve, abi: curveAbi, functionName: "sell", args: [amountIn, minOut, address] });
        setBusy("confirming");
        setLastTx(hash);
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setRaw("");
      await queryClient.invalidateQueries({ queryKey: ["city"] });
      await queryClient.invalidateQueries({ queryKey: ["parcel"] });
      onTraded();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  if (graduated) {
    return (
      <div className="px-4 py-4" data-trade-panel>
        <p className="pixel text-[14px] text-outline">graduated — trading moved to the pool.</p>
        <p className="mt-1 text-[12px] text-ink-2">
          the curve is closed. trade on{" "}
          <a href={`https://www.ponsfamily.com/launchpad/${parcel.token}`} target="_blank" rel="noreferrer" className="underline">
            pons
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4" data-trade-panel>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button type="button" className="chip" data-on={side === "buy"} onClick={() => { setSide("buy"); setError(null); }} data-side="buy">
            buy
          </button>
          <button type="button" className="chip" data-on={side === "sell"} onClick={() => { setSide("sell"); setError(null); }} data-side="sell">
            sell
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="label">slip</span>
          {SLIPPAGES.map((s) => (
            <button key={String(s)} type="button" className="chip" data-on={slippage === s} onClick={() => setSlippage(s)}>
              {Number(s) / 100}%
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          className="mc-field mono"
          inputMode="decimal"
          placeholder={side === "buy" ? "amount in eth" : `$${parcel.symbol} to sell`}
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setError(null); }}
          aria-label={side === "buy" ? "amount in eth" : "tokens to sell"}
          data-amount
        />
        <button
          type="button"
          className="chip"
          onClick={() => setRaw(formatUnitsTrim(side === "buy" ? (available > 10n ** 15n ? available - 10n ** 15n : 0n) : available, 18, 6))}
          disabled={!address}
        >
          max
        </button>
      </div>
      <div className="mono mt-2 flex justify-between text-[11px] text-ink-2">
        <span>you have {side === "buy" ? `${formatUnitsTrim(ethBalance, 18, 5)} eth` : `${tokenAmount(balance)} $${parcel.symbol}`}</span>
        <span>
          {amountIn > 0n
            ? side === "buy"
              ? `≈ ${tokenAmount(out)} $${parcel.symbol} · min ${tokenAmount(minOut)}`
              : `≈ ${formatUnitsTrim(out, 18, 6)} eth · min ${formatUnitsTrim(minOut, 18, 6)}`
            : ""}
        </span>
      </div>
      {amountIn > 0n ? (
        <div className="mono mt-1 flex justify-between text-[11px] text-ink-2">
          <span>
            fee {Number(feeBps) / 100}%{creatorTaxBps > 0n ? ` + tax ${Number(creatorTaxBps) / 100}%` : ""}
            {snipe.data && snipe.data > 0n ? ` + snipe ${Number(snipe.data) / 100}%` : ""}
          </span>
          <span>impact {(Number(impact) / 100).toFixed(2)}%</span>
        </div>
      ) : null}

      <div className="mt-3">
        {!mounted || !address ? (
          <ConnectButton size="md" full />
        ) : (
          <button type="button" className={`mc-btn w-full ${side === "buy" ? "mc-btn-primary" : ""}`} disabled={amountIn <= 0n || tooMuch || wrongChain || busy !== null} onClick={submit} data-trade-submit>
            {busy === "approving"
              ? "approving…"
              : busy === "sending"
                ? "confirm in your wallet…"
                : busy === "confirming"
                  ? "confirming…"
                  : wrongChain
                    ? "switch to robinhood chain"
                    : tooMuch
                      ? "not enough"
                      : side === "buy"
                        ? `buy $${parcel.symbol}`
                        : `sell $${parcel.symbol}`}
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-down" data-trade-error>
          {error}
        </p>
      ) : null}
      {lastTx ? (
        <p className="mono mt-2 text-[11px] text-ink-2">
          tx{" "}
          <a href={explorer.tx(lastTx)} target="_blank" rel="noreferrer" className="underline">
            {lastTx.slice(0, 10)}…
          </a>
        </p>
      ) : null}
      {snipe.data && snipe.data > 0n ? <p className="mt-2 text-[11px] text-ink-2">this wallet still pays the launch snipe tax on this curve; it is gone seconds after launch.</p> : null}
    </div>
  );
}
