"use client";

import { useState } from "react";
import { logoUrl } from "@/lib/format";

/** A token's logo, or a pixel plate with its first letter when there is none. */
export function TokenLogo({ logo, symbol, size = 48, className = "" }: { logo: string; symbol: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const url = logoUrl(logo);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={size} height={size} className={`pixelated shrink-0 border-2 border-outline bg-slot object-cover ${className}`} style={{ width: size, height: size }} onError={() => setBroken(true)} />
    );
  }
  const letter = (symbol.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase();
  return (
    <span className={`mc-slot pixel flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {letter}
    </span>
  );
}
