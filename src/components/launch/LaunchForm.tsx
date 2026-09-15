"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseEventLogs, type Hex } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ConnectButton } from "../ConnectButton";
import { DeployMarket } from "../DeployMarket";
import { useCity, useMounted } from "@/hooks/useCity";
import { pixelMarketAbi } from "@/lib/abi/pixelMarketAbi";
import { CHAIN_ID, explorer } from "@/lib/chain";
import { placeOf } from "@/lib/city/layout";
import { TIERS } from "@/lib/city/levels";
import { LAUNCH_CONFIG_ID, LAUNCH_FEE_ETH_DISPLAY } from "@/lib/contracts";
import { ETH_PHANTOM_QUOTE, LAUNCH_SUPPLY, formatUnitsTrim, parseDecimal, quoteBuy } from "@/lib/curvemath";
import { explainError } from "@/lib/errors";
import { tokenAmount } from "@/lib/format";
import { MARKET } from "@/lib/marketDeploy";
import { site } from "@/lib/site";

const NAME_MAX = 32;
const SYMBOL_MAX = 10;
const DESC_MAX = 280;

/**
 * One transaction: the token and its curve are created on Pons V2 and the
 * next parcel is yours. With a first buy the launch goes through Pons'
 * forwarder (atomic, snipe-tax exempt); without one, straight through the
 * factory. minTokensOut is 0 on purpose: the curve does not exist before
 * this transaction, so nothing can front-run the first buy.
 */
export function LaunchForm() {
  const mounted = useMounted();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const city = useCity();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [logo, setLogo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [buyRaw, setBuyRaw] = useState("0.01");
  const [taxPct, setTaxPct] = useState("0");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<null | "sending" | "confirming">(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [done, setDone] = useState<{ parcelId: number; token: string } | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const deployed = Boolean(city.data?.deployed);
  const fee = useReadContract({ address: MARKET, abi: pixelMarketAbi, functionName: "launchFee", query: { enabled: deployed } });
  const ethBalance = useBalance({ address, query: { enabled: Boolean(address) } });

  const buy = useMemo(() => parseDecimal(buyRaw) ?? 0n, [buyRaw]);
  const taxBps = Math.max(0, Math.min(1000, Math.round((Number(taxPct) || 0) * 100)));
  const launchFee = fee.data ?? 0n;
  const value = launchFee + buy;
  const estimate = buy > 0n ? quoteBuy(ETH_PHANTOM_QUOTE, LAUNCH_SUPPLY, buy, 100n, BigInt(taxBps)) : 0n;
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID;
  const short = (ethBalance.data?.value ?? 0n) < value;
  const nextId = city.data?.parcels.length ?? 0;
  const place = placeOf(nextId);
  const nameOk = name.trim().length > 0 && name.trim().length <= NAME_MAX;
  const symbolClean = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const symbolOk = symbolClean.length > 0 && symbolClean.length <= SYMBOL_MAX;

  useEffect(() => {
    import("@/lib/city/thumbs")
      .then(({ thumbnail }) => setThumb(thumbnail(0, 0, 160, 200)))
      .catch(() => setThumb(null));
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setUploadNote(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const r = await fetch("/api/upload", { method: "POST", body });
      const j = (await r.json()) as { uri?: string; error?: string };
      if (!r.ok || !j.uri) throw new Error(j.error ?? "upload failed");
      setLogo(j.uri);
      setUploadNote("pinned.");
    } catch (e) {
      setUploadNote(`${(e as Error).message.toLowerCase()} — paste an https url instead.`);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!address || !publicClient || !nameOk || !symbolOk) return;
    setError(null);
    setTxHash(null);
    try {
      setBusy("sending");
      const hash = await writeContractAsync({
        address: MARKET,
        abi: pixelMarketAbi,
        functionName: "launch",
        args: [name.trim(), symbolClean, logo.trim(), description.trim(), [x.trim(), telegram.trim(), website.trim(), "", ""], taxBps, LAUNCH_CONFIG_ID, buy, 0n],
        value,
      });
      setTxHash(hash);
      setBusy("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("the transaction reverted");
      const built = parseEventLogs({ abi: pixelMarketAbi, eventName: "ParcelBuilt", logs: receipt.logs })[0];
      const parcelId = built ? Number(built.args.parcelId) : nextId;
      setDone({ parcelId, token: built ? built.args.token : "" });
      await queryClient.invalidateQueries({ queryKey: ["city"] });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="mc-panel mc-panel-pad" data-launch-done>
        <span className="label">built</span>
        <p className="pixel mt-2 text-[28px] leading-none text-outline">parcel #{done.parcelId} is yours.</p>
        <p className="mt-3 text-[14px] leading-snug text-ink-2">
          ${symbolClean} exists, its curve is open, and there is a sign on your lot. every trade grows the building; creator fees on every trade go to your wallet.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/p/${done.parcelId}`} className="mc-btn mc-btn-primary" data-see-parcel>
            see it in the city
          </Link>
          {done.token ? (
            <a href={explorer.token(done.token)} target="_blank" rel="noreferrer" className="mc-btn">
              explorer
            </a>
          ) : null}
        </div>
        {txHash ? (
          <p className="mono mt-3 text-[11px] text-ink-2">
            tx{" "}
            <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="underline">
              {txHash}
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
      <form
        className="mc-panel mc-panel-pad flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        data-launch-form
      >
        <div>
          <p className="pixel text-[28px] leading-none text-outline">launch a token. take a parcel.</p>
          <p className="mt-2 text-[14px] leading-snug text-ink-2">
            one transaction on robinhood chain: pons v2 creates the token and its bonding curve, and the next parcel in the city is yours. {site.name.toLowerCase()} keeps nothing — creator fees on every trade are paid to you by pons.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
          <label className="flex flex-col gap-1">
            <span className="label">name</span>
            <input className="mc-field" placeholder="Pixel Coin" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} data-name />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">ticker</span>
            <input className="mc-field mono uppercase" placeholder="PXL" maxLength={SYMBOL_MAX} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} data-symbol />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label">logo</span>
          <div className="flex gap-2">
            <input className="mc-field mono" placeholder="ipfs://… or https://…" value={logo} onChange={(e) => setLogo(e.target.value)} data-logo />
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <button type="button" className="chip whitespace-nowrap" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "pinning…" : "upload"}
            </button>
          </div>
          {uploadNote ? <span className="text-[11px] text-ink-2">{uploadNote}</span> : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">one line about it</span>
          <textarea className="mc-field" rows={2} maxLength={DESC_MAX} placeholder="what is this, in a sentence." value={description} onChange={(e) => setDescription(e.target.value)} data-description />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">x</span>
            <input className="mc-field mono" placeholder="https://x.com/…" value={x} onChange={(e) => setX(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">telegram</span>
            <input className="mc-field mono" placeholder="https://t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">website</span>
            <input className="mc-field mono" placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label">first buy, in eth (optional)</span>
          <input className="mc-field mono" inputMode="decimal" placeholder="0.01" value={buyRaw} onChange={(e) => setBuyRaw(e.target.value)} data-buy />
          <span className="mono text-[11px] text-ink-2">
            {buy > 0n
              ? `≈ ${tokenAmount(estimate)} $${symbolClean || "TOKEN"} of 1 000 000 000, at the curve's opening price. counts as the first trade: your lot becomes a shack at 0.01 eth.`
              : "no first buy: the curve opens with nobody in it and your lot stays a lot until someone trades."}
          </span>
        </label>

        <button type="button" className="self-start text-[11px] text-ink-2 underline" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "hide" : "advanced"}
        </button>
        {advanced ? (
          <label className="flex flex-col gap-1">
            <span className="label">creator tax, % on every trade (0–10)</span>
            <input className="mc-field mono w-32" inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
            <span className="text-[11px] text-ink-2">on top of pons&apos; 1% trade fee. it goes to you, like the creator fees. most launches leave it at 0.</span>
          </label>
        ) : null}

        <div className="mc-slot px-3 py-2">
          <div className="mono flex justify-between text-[11px]">
            <span>launch fee (pons)</span>
            <span>{fee.data !== undefined ? `${formatUnitsTrim(fee.data, 18, 6)} eth` : `${LAUNCH_FEE_ETH_DISPLAY} eth`}</span>
          </div>
          <div className="mono mt-1 flex justify-between text-[11px]">
            <span>first buy</span>
            <span>{formatUnitsTrim(buy, 18, 6)} eth</span>
          </div>
          <div className="mono mt-1 flex justify-between text-[11px]">
            <span>{site.name.toLowerCase()} takes</span>
            <span>nothing</span>
          </div>
          <div className="pixel mt-1 flex justify-between text-[14px]">
            <span>you send</span>
            <span>{formatUnitsTrim(value, 18, 6)} eth</span>
          </div>
        </div>

        {city.data && !deployed ? (
          <DeployMarket compact />
        ) : !mounted || !address ? (
          <ConnectButton size="md" full />
        ) : (
          <button type="button" className="mc-btn mc-btn-primary mc-btn-lg w-full" disabled={!nameOk || !symbolOk || busy !== null || wrongChain || short || !deployed} onClick={submit} data-launch-submit>
            {busy === "sending"
              ? "confirm in your wallet…"
              : busy === "confirming"
                ? "building…"
                : wrongChain
                  ? "switch to robinhood chain"
                  : short
                    ? "not enough eth"
                    : !nameOk || !symbolOk
                      ? "name and ticker first"
                      : `launch $${symbolClean} · take parcel #${nextId}`}
          </button>
        )}
        {error ? (
          <p className="text-[12px] text-down" data-launch-error>
            {error}
          </p>
        ) : null}
        {txHash ? (
          <p className="mono text-[11px] text-ink-2">
            tx{" "}
            <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="underline">
              {txHash.slice(0, 14)}…
            </a>
          </p>
        ) : null}
      </form>

      <aside className="mc-panel mc-panel-pad flex flex-col" data-launch-preview>
        <span className="label">your parcel</span>
        <p className="pixel mt-1 text-[22px] leading-none text-outline">#{nextId}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          ring {place.ring} from the square · block {place.block.bx},{place.block.bz}
        </p>
        <div className="mc-slot mt-3 flex h-[190px] items-end justify-center">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="An empty lot with a sign" className="pixelated max-h-[180px] w-auto" draggable={false} />
          ) : null}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-ink-2">it starts as a lot with your ticker on a sign. then:</p>
        <ul className="mt-2 flex flex-col gap-1">
          {TIERS.slice(1).map((t) => (
            <li key={t.key} className="flex items-center justify-between text-[12px]">
              <span className={`pixel ${t.key === "landmark" ? "text-gold-dark" : "text-outline"}`}>{t.label.toLowerCase()}</span>
              <span className="mono text-ink-2">{t.key === "landmark" ? "graduation" : `${t.minVolume} eth traded`}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-snug text-ink-2">a token launched anywhere else on pons has no parcel here. the parcel number is the launch order, forever.</p>
      </aside>
    </div>
  );
}
