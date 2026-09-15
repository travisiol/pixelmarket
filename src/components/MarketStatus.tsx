"use client";

import Link from "next/link";
import { useCity } from "@/hooks/useCity";
import { explorer } from "@/lib/chain";
import { shortAddress } from "@/lib/format";
import { MARKET } from "@/lib/marketDeploy";

/** Footer line: the market's address, and whether it is on the chain yet. */
export function MarketStatus() {
  const { data } = useCity();
  const state = !data ? "…" : data.deployed ? "on chain" : "not deployed yet";
  return (
    <span className="mono text-[11px]" data-market-status>
      market{" "}
      <a href={explorer.address(MARKET)} target="_blank" rel="noreferrer" className="underline">
        {shortAddress(MARKET, 5)}
      </a>{" "}
      · {state}
      {data && !data.deployed ? (
        <>
          {" · "}
          <Link href="/deploy" className="underline">
            deploy it
          </Link>
        </>
      ) : null}
    </span>
  );
}
