"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { useCity, useMounted } from "@/hooks/useCity";
import { CHAIN_ID, explorer } from "@/lib/chain";
import { explainError } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import { MARKET, marketDeployTx } from "@/lib/marketDeploy";

/**
 * Puts the market on the chain from whoever's wallet is connected: one
 * transaction to the deterministic deployer, which CREATE2s the contract
 * at the address the site already reads. No key, no admin, no owner —
 * the deployer just pays the gas, once, for everyone.
 */
export function DeployMarket({ compact = false }: { compact?: boolean }) {
  const mounted = useMounted();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { sendTransactionAsync } = useSendTransaction();
  const city = useCity();
  const [gas, setGas] = useState<{ units: bigint; costWei: bigint } | null>(null);
  const [busy, setBusy] = useState<null | "sending" | "confirming">(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [done, setDone] = useState<{ block: bigint } | null>(null);

  const deployed = Boolean(city.data?.deployed);
  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID;

  useEffect(() => {
    if (!address || !publicClient || deployed || wrongChain) return;
    let cancelled = false;
    const tx = marketDeployTx();
    Promise.all([publicClient.estimateGas({ account: address, to: tx.to, data: tx.data }), publicClient.getGasPrice()])
      .then(([units, price]) => {
        if (!cancelled) setGas({ units, costWei: units * price });
      })
      .catch(() => {
        if (!cancelled) setGas(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, publicClient, deployed, wrongChain]);

  async function deploy() {
    if (!address || !publicClient) return;
    setError(null);
    setTxHash(null);
    try {
      setBusy("sending");
      const tx = marketDeployTx();
      const hash = await sendTransactionAsync({ to: tx.to, data: tx.data });
      setTxHash(hash);
      setBusy("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("the deployer reverted — is the market already there?");
      const code = await publicClient.getCode({ address: MARKET });
      if (!code || code === "0x") throw new Error("the transaction went through but no code appeared at the expected address");
      setDone({ block: receipt.blockNumber });
      await queryClient.invalidateQueries({ queryKey: ["city"] });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  if (deployed || done) {
    return (
      <div data-deploy-done>
        <span className="label">the market</span>
        <p className="mt-2 text-[14px] text-ink">
          on robinhood chain at{" "}
          <a href={explorer.address(MARKET)} target="_blank" rel="noreferrer" className="mono underline">
            {shortAddress(MARKET, 6)}
          </a>
          {done ? <span className="mono text-ink-2"> · block {done.block.toString()}</span> : null}
        </p>
        {txHash ? (
          <p className="mono mt-1 text-[11px] text-ink-2">
            tx{" "}
            <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="underline">
              {txHash.slice(0, 12)}…
            </a>
          </p>
        ) : null}
        {done && compact ? <p className="mt-2 text-[12px] text-ink-2">the city is reading it. you can launch now.</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-deploy-market>
      <div>
        <span className="label">the market</span>
        <p className="mt-2 text-[13px] leading-snug text-ink-2">
          {compact ? "the market isn't on robinhood chain yet. " : ""}
          it will live at{" "}
          <a href={explorer.address(MARKET)} target="_blank" rel="noreferrer" className="mono text-ink underline">
            {shortAddress(MARKET, 6)}
          </a>
          {" — "}
          the address is fixed by its code, so anyone can put it there. one transaction, gas only, no owner, no key.
          {compact ? " usually the first launcher does it, then launches." : ""}
        </p>
      </div>
      {!mounted || !address ? (
        <ConnectButton size="md" />
      ) : (
        <button type="button" className="mc-btn mc-btn-gold" disabled={busy !== null || wrongChain} onClick={deploy} data-deploy-submit>
          {busy === "sending" ? "confirm in your wallet…" : busy === "confirming" ? "deploying…" : wrongChain ? "switch to robinhood chain" : "deploy the market"}
        </button>
      )}
      {gas ? (
        <p className="mono text-[11px] text-ink-2">
          ≈ {gas.units.toString()} gas · ≈ {formatEther(gas.costWei).slice(0, 10)} eth at the current gas price
        </p>
      ) : null}
      {error ? (
        <p className="text-[12px] text-down" data-deploy-error>
          {error}
        </p>
      ) : null}
      {txHash && !done ? (
        <p className="mono text-[11px] text-ink-2">
          tx{" "}
          <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="underline">
            {txHash.slice(0, 12)}…
          </a>
        </p>
      ) : null}
      {compact ? (
        <Link href="/deploy" className="text-[11px] text-ink-2 underline">
          what exactly gets deployed
        </Link>
      ) : null}
    </div>
  );
}
