import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { MarketStatus } from "./MarketStatus";
import { site } from "@/lib/site";

/** The frame of every page that is not the city: nav, a panel, a footer. */
export function PageShell({ children, width = "max-w-3xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className={`mx-auto w-full ${width} px-2 pb-10 pt-4 sm:px-3 sm:pt-6`}>{children}</main>
      <footer className="mx-2 mb-2 mt-auto sm:mx-3 sm:mb-3">
        <div className="mc-panel flex flex-col gap-2 px-4 py-3 text-[12px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="pixel text-outline">{site.name.toLowerCase()}</span> · built on robinhood chain · pons v2 · eth
          </span>
          <MarketStatus />
          <span className="flex gap-3">
            <Link href="/how" className="underline">
              how it works
            </Link>
            <Link href="/deploy" className="underline">
              the contract
            </Link>
            {site.x ? (
              <a href={site.x} target="_blank" rel="noreferrer" className="underline">
                x
              </a>
            ) : null}
          </span>
        </div>
      </footer>
    </div>
  );
}
