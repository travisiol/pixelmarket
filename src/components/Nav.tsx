"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { PixelWordmark } from "./PixelWordmark";

const LINKS = [
  { href: "/", label: "city", short: "city" },
  { href: "/launch", label: "launch", short: "launch" },
  { href: "/how", label: "how it works", short: "how" },
] as const;

/** The top bar: wordmark, three links, the wallet. Same on every page. */
export function Nav() {
  const path = usePathname();
  return (
    <header className="mc-panel relative z-30 mx-2 mt-2 flex items-center gap-3 px-3 py-2 sm:mx-3 sm:mt-3 sm:gap-4 sm:px-4">
      <Link href="/" className="flex shrink-0 items-center" aria-label="Pixel Market, home">
        <PixelWordmark height={22} />
      </Link>
      <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Main">
        {LINKS.map((l) => {
          const on = l.href === "/" ? path === "/" || path.startsWith("/p/") : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`pixel px-2 py-1 text-[15px] ${on ? "text-outline underline decoration-2 underline-offset-4" : "text-ink-2 hover:text-outline"}`} data-nav={l.label}>
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden sm:block">
        <ConnectButton size="sm" />
      </div>
    </header>
  );
}
