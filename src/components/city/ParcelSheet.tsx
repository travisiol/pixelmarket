"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { zeroAddress, type Hex } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { TokenLogo } from "../TokenLogo";
import { TradePanel } from "./TradePanel";
import { useMounted, useParcelDetail } from "@/hooks/useCity";
import { explorer } from "@/lib/chain";
import { placeOf } from "@/lib/city/layout";
import { levelOf, TIERS } from "@/lib/city/levels";
import { PONS_FEE_ESCROW } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import { ago, eth, shortAddress, tinyPrice, toNumber, tokenAmount, usd } from "@/lib/format";
import { erc20Abi, escrowAbi } from "@/lib/ponsAbi";
import { site } from "@/lib/site";
import type { ParcelJson } from "@/lib/types";

/**
 * One building's sheet: what it is, how tall it is and why, its numbers,
 * a trade panel, who built it and where the creator fees go.
 */
export function ParcelSheet({ parcel, ethUsd, onClose, onNavigate }: { parcel: ParcelJson; ethUsd: number | null; onClose: () => void; onNavigate: (href: string) => void }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const detail = useParcelDetail(parcel.id);
  const ethBalance = useBalance({ address, query: { enabled: Boolean(address), refetchInterval: 15_000 } });
  const tokenBalance = useReadContract({ address: parcel.token, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], query: { enabled: Boolean(address), refetchInterval: 15_000 } });
  const refreshAll = () => {
    void detail.refetch();
    void ethBalance.refetch();
    void tokenBalance.refetch();
  };
  const level = levelOf(parcel.activity.volume, Boolean(parcel.state?.graduated));
  const tier = TIERS[parcel.level.tier];
  const place = placeOf(parcel.id);
  const spot = toNumber(parcel.spotWei);
  const cap = toNumber(parcel.capWei);
  const isCreator = Boolean(address && address.toLowerCase() === parcel.creator.toLowerCase());
  const landmark = tier.key === "landmark";

  return (
    <aside
      className="sheet-in scroll-thin fixed inset-x-2 bottom-2 z-40 max-h-[72vh] overflow-y-auto mc-panel md:inset-x-auto md:bottom-3 md:right-3 md:top-[76px] md:max-h-none md:w-[400px]"
      aria-label={`${parcel.name} parcel`}
      data-sheet={parcel.id}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <TokenLogo logo={parcel.logo} symbol={parcel.symbol} size={56} />
        <div className="min-w-0 flex-1">
          <p className="pixel truncate text-[22px] leading-none text-outline">${parcel.symbol}</p>
          <p className="mt-1 truncate text-[13px] text-ink-2">{parcel.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`plate ${landmark ? "plate-gold" : ""}`} data-tier-plate>
              {tier.label.toLowerCase()}
              {level.floors > 0 ? ` · ${level.floors} fl` : ""}
            </span>
            <span className="plate">parcel #{parcel.id}</span>
          </div>
        </div>
        <button type="button" className="chip" onClick={onClose} aria-label="Close" data-close>
          close
        </button>
      </div>

      {/* level */}
      <div className="px-4 pt-4" data-level>
        <div className="flex items-end justify-between">
          <span className="label">building</span>
          <span className="pixel text-[12px] text-ink-2">
            {level.next ? `next: ${level.next.label.toLowerCase()} at ${level.next.minVolume} eth` : landmark ? "graduated" : "graduate to become a landmark"}
          </span>
        </div>
        <div className={`xp mt-1 ${landmark ? "xp-gold" : ""}`} style={{ "--w": `${Math.round((landmark ? 1 : level.progress) * 100)}%` } as React.CSSProperties}>
          <span />
        </div>
        <p className="mt-1 text-[12px] text-ink-2">
          {eth(parcel.activity.volume)} traded{level.toNext !== null && level.toNext > 0 ? ` · ${eth(level.toNext)} more to grow` : ""} · {tier.blurb}
        </p>
      </div>

      {/* numbers */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-3" data-numbers>
        <Num label="price" value={ethUsd ? usd(spot * ethUsd) : tinyPrice(spot)} sub={ethUsd ? tinyPrice(spot) : undefined} />
        <Num label="market cap" value={ethUsd ? usd(cap * ethUsd) : eth(cap)} sub={ethUsd ? eth(cap) : undefined} />
        <Num label="trades" value={String(parcel.activity.trades)} sub={`${parcel.activity.traders} wallet${parcel.activity.traders === 1 ? "" : "s"}`} />
      </div>
      <div className="px-4 pt-3">
        <div className="flex items-end justify-between">
          <span className="label">graduation</span>
          <span className="pixel text-[12px] text-ink-2">
            {parcel.state ? `${eth(toNumber(parcel.state.realQuote))} of ${eth(toNumber(parcel.state.threshold))}` : "—"}
          </span>
        </div>
        <div className="xp xp-gold mt-1" style={{ "--w": `${Math.round(parcel.progress)}%` } as React.CSSProperties}>
          <span />
        </div>
      </div>

      <div className="rule mt-4">
        <TradePanel parcel={parcel} balance={tokenBalance.data ?? 0n} ethBalance={ethBalance.data?.value ?? 0n} onTraded={refreshAll} />
      </div>

      {parcel.description ? <p className="rule px-4 py-3 text-[13px] leading-snug text-ink">{parcel.description}</p> : null}

      {/* creator & fees */}
      <div className="rule px-4 py-3" data-creator>
        <span className="label">built by</span>
        <p className="mono mt-1 text-[12px] text-ink">
          <a href={explorer.address(parcel.creator)} target="_blank" rel="noreferrer" className="underline">
            {shortAddress(parcel.creator, 6)}
          </a>
          {isCreator ? " — you" : ""} · {ago(parcel.launchedAt) || "just now"} · ring {place.ring}, block {place.block.bx},{place.block.bz}
        </p>
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          creator fees on every trade go to the creator, paid by pons. {site.name.toLowerCase()} keeps nothing.
        </p>
        {mounted && isCreator ? <ClaimFees escrowWei={detail.data?.escrowWei ?? "0"} onClaimed={() => detail.refetch()} /> : null}
      </div>

      {/* trades */}
      <div className="rule px-4 py-3" data-trades>
        <div className="flex items-center justify-between">
          <span className="label">recent trades</span>
          <span className="pixel text-[12px] text-ink-2">{detail.data?.holderCount != null ? `${detail.data.holderCount} holder${detail.data.holderCount === 1 ? "" : "s"}` : ""}</span>
        </div>
        {detail.data?.trades && detail.data.trades.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {detail.data.trades.slice(0, 8).map((t) => (
              <li key={t.tx + t.kind + t.block} className="mono flex items-center justify-between text-[11px]">
                <span className={t.kind === "buy" ? "text-up" : "text-down"}>{t.kind}</span>
                <span className="text-ink">{eth(toNumber(t.quoteWei))}</span>
                <span className="text-ink-2">{tokenAmount(t.tokensWei)}</span>
                <a href={explorer.tx(t.tx)} target="_blank" rel="noreferrer" className="text-ink-2 underline">
                  {shortAddress(t.sender)}
                </a>
                <span className="text-ink-3">{ago(t.timestamp)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12px] text-ink-2">{detail.data ? "no trades yet." : detail.isError ? "trades unavailable." : "reading…"}</p>
        )}
      </div>

      {/* links */}
      <div className="flex flex-wrap gap-2 px-4 pb-4 pt-3">
        <a href={explorer.token(parcel.token)} target="_blank" rel="noreferrer" className="mc-btn mc-btn-sm">
          explorer
        </a>
        <a href={site.ponsTokenUrl(parcel.token)} target="_blank" rel="noreferrer" className="mc-btn mc-btn-sm">
          on pons
        </a>
        <button type="button" className="mc-btn mc-btn-sm" onClick={() => onNavigate(`/p/${parcel.id}`)} data-share>
          share
        </button>
      </div>
    </aside>
  );
}

function Num({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mc-slot flex flex-col px-2 py-1.5">
      <span className="pixel num truncate text-[15px] leading-none">{value}</span>
      <span className="pixel mt-1 truncate text-[10px] leading-none text-[#e5e5e5]">{label}</span>
      {sub ? <span className="mono mt-0.5 truncate text-[10px] text-[#dedede]">{sub}</span> : null}
    </div>
  );
}

/** The creator's pending fees on Pons' escrow (across all their tokens), and the claim. */
function ClaimFees({ escrowWei, onClaimed }: { escrowWei: string; onClaimed: () => void }) {
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const pending = BigInt(escrowWei);
  async function claim() {
    if (!publicClient) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({ address: PONS_FEE_ESCROW, abi: escrowAbi, functionName: "claim" });
      setTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await queryClient.invalidateQueries({ queryKey: ["parcel"] });
      onClaimed();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-claim-fees>
      <span className="mono text-[12px] text-ink">{eth(toNumber(pending))} swept to escrow for you (all your tokens)</span>
      <button type="button" className="mc-btn mc-btn-sm mc-btn-gold" disabled={pending === 0n || busy} onClick={claim}>
        {busy ? "claiming…" : "claim"}
      </button>
      {tx ? (
        <a href={explorer.tx(tx)} target="_blank" rel="noreferrer" className="mono text-[11px] underline">
          tx
        </a>
      ) : null}
      {error ? <span className="text-[11px] text-down">{error}</span> : null}
      <span className="w-full text-[11px] text-ink-2">the rest is accruing on the curve until pons sweeps it.</span>
    </div>
  );
}
