"use client";

import { useEffect, useState } from "react";
import { TIERS, type Tier } from "@/lib/city/levels";

/** The eight buildings, rendered once from the same voxels as the city. */
export function useTierThumbs(width = 120, height = 150): Map<number, string> {
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    import("@/lib/city/thumbs")
      .then(({ thumbnail }) => {
        if (cancelled) return;
        const m = new Map<number, string>();
        for (const t of TIERS) {
          try {
            m.set(t.id, thumbnail(t.id, undefined, width, height));
          } catch {
            /* no webgl: the legend shows text only */
          }
        }
        setThumbs(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [width, height]);
  return thumbs;
}

export function thresholdLabel(t: Tier): string {
  if (t.key === "lot") return "launched";
  if (t.key === "landmark") return "graduated";
  return `≥ ${t.minVolume} eth traded`;
}

/** Compact legend for the city's HUD. */
export function TierLegend({ onClose }: { onClose: () => void }) {
  const thumbs = useTierThumbs(96, 120);
  return (
    <div className="mc-panel w-[calc(100vw-16px)] max-w-[760px] px-3 py-3 sm:w-auto" data-legend>
      <div className="flex items-center justify-between">
        <p className="pixel text-[15px] text-outline">buildings grow with traded volume</p>
        <button type="button" className="chip" onClick={onClose} aria-label="Close the legend">
          close
        </button>
      </div>
      <div className="scroll-thin mt-2 flex gap-2 overflow-x-auto pb-1">
        {TIERS.map((t) => (
          <div key={t.key} className="mc-slot flex w-[92px] shrink-0 flex-col items-center px-1 pb-2 pt-1" data-tier={t.key}>
            <div className="flex h-[80px] w-[64px] items-end justify-center">
              {thumbs.get(t.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs.get(t.id)} alt={t.label} className="pixelated max-h-[80px] w-auto" draggable={false} />
              ) : null}
            </div>
            <span className={`pixel mt-1 text-[12px] leading-none ${t.key === "landmark" ? "text-gold" : ""}`}>{t.label.toLowerCase()}</span>
            <span className="mt-1 text-center text-[10px] leading-tight text-[#e5e5e5]">{thresholdLabel(t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full-width strip for the how-it-works page. */
export function TierStrip() {
  const thumbs = useTierThumbs(160, 200);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TIERS.map((t) => (
        <div key={t.key} className="mc-slot flex flex-col items-center px-2 pb-3 pt-2" data-tier={t.key}>
          <div className="flex h-[150px] items-end justify-center">
            {thumbs.get(t.id) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs.get(t.id)} alt={t.label} className="pixelated max-h-[150px] w-auto" draggable={false} />
            ) : (
              <span className="pixel text-[12px] text-[#e5e5e5]">{t.label}</span>
            )}
          </div>
          <span className={`pixel mt-2 text-[15px] leading-none ${t.key === "landmark" ? "text-gold" : ""}`}>{t.label.toLowerCase()}</span>
          <span className="mt-1 text-[11px] text-[#e5e5e5]">{thresholdLabel(t)}</span>
          <span className="mt-1 text-[11px] text-[#c8c8c8]">{t.floors[0] === t.floors[1] ? (t.floors[0] === 0 ? "no floors yet" : `${t.floors[0]} floor`) : `${t.floors[0]}–${t.floors[1]} floors`}</span>
          <span className="mt-2 text-center text-[11px] leading-tight text-[#e5e5e5]">{t.blurb}</span>
        </div>
      ))}
    </div>
  );
}
