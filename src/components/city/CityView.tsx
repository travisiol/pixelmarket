"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "../ConnectButton";
import { Nav } from "../Nav";
import { ParcelSheet } from "./ParcelSheet";
import { TierLegend } from "./TierLegend";
import { useCity } from "@/hooks/useCity";
import { TIERS } from "@/lib/city/levels";
import { CityScene, type CityParcel } from "@/lib/city/scene";
import { eth, usd } from "@/lib/format";
import { site } from "@/lib/site";
import type { ParcelJson } from "@/lib/types";

/** Where the sheet will sit: right of the building on wide screens, under it on phones. */
function sheetShift(): [number, number] {
  return window.innerWidth >= 768 ? [200, 0] : [0, window.innerHeight * 0.28];
}

/**
 * The city is the product: it fills the screen, the nav floats on top,
 * the hook sits bottom-left, the numbers bottom-right, and a building's
 * sheet slides in from the right when you click it.
 */
export function CityView({ initialParcel = null }: { initialParcel?: number | null }) {
  const router = useRouter();
  const city = useCity();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const [selected, setSelected] = useState<number | null>(initialParcel);
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null);
  const [legend, setLegend] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const fitted = useRef(false);

  const parcels = useMemo(() => city.data?.parcels ?? [], [city.data]);
  const byId = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);
  const selectedParcel: ParcelJson | null = selected !== null ? (byId.get(selected) ?? null) : null;

  const select = useCallback(
    (id: number | null, focus = true) => {
      setSelected(id);
      sceneRef.current?.select(id);
      if (id !== null && focus) sceneRef.current?.focus(id, undefined, ...sheetShift());
      window.history.replaceState(null, "", id === null ? "/" : `/p/${id}`);
    },
    [],
  );

  // Boot the scene once.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let scene: CityScene;
    try {
      scene = new CityScene(container, canvas, {
        onHover: (id, x, y) => setHover(id === null ? null : { id, x, y }),
        onSelect: (id) => select(id, id !== null),
        onMove: () => setHover(null),
      });
    } catch {
      // No WebGL: say so once the effect has settled rather than mid-render.
      queueMicrotask(() => setWebgl(false));
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [select]);

  // Feed the scene whenever the chain moved.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !city.data) return;
    const list: CityParcel[] = parcels.map((p) => ({ id: p.id, tier: p.level.tier, floors: p.level.floors, symbol: p.symbol }));
    scene.setCity(list);
    if (!fitted.current) {
      fitted.current = true;
      if (initialParcel !== null && byId.has(initialParcel)) {
        scene.fitCity(false);
        scene.select(initialParcel);
        scene.focus(initialParcel, 1.5, ...sheetShift());
      } else {
        scene.fitCity(false);
      }
    } else if (selected !== null) {
      scene.select(selected);
    }
  }, [city.data, parcels, byId, initialParcel, selected]);

  const hovered = hover ? byId.get(hover.id) : undefined;
  const data = city.data;
  const empty = data?.deployed && parcels.length === 0;

  return (
    <div className="fixed inset-0 overflow-hidden" data-city>
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" aria-label="The pixel city" />
      </div>

      {/* floating nav */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
        <div className="pointer-events-auto">
          <Nav />
        </div>
      </div>

      {/* hook */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col gap-2 sm:inset-x-3 sm:bottom-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="pointer-events-auto mc-panel mc-panel-pad w-full max-w-sm" data-hero>
          <p className="pixel text-[24px] leading-none text-outline sm:text-[30px]">{site.hook}</p>
          <p className="mt-2 text-[13px] leading-snug text-ink-2 sm:text-[14px]">
            launch a token on robinhood chain, get a parcel in the city. the more it trades, the taller its building.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/launch" className="mc-btn mc-btn-primary" data-cta-launch>
              launch a token
            </Link>
            <Link href="/how" className="mc-btn" data-cta-how>
              how it works
            </Link>
            <span className="sm:hidden">
              <ConnectButton size="md" />
            </span>
          </div>
          {data && !data.deployed ? (
            <p className="mt-3 text-[12px] leading-snug text-ink-2" data-not-deployed>
              the market isn&apos;t on robinhood chain yet.{" "}
              <Link href="/deploy" className="underline">
                anyone can deploy it
              </Link>{" "}
              — one transaction, gas only.
            </p>
          ) : null}
          {empty ? (
            <p className="mt-3 text-[12px] leading-snug text-ink-2" data-empty>
              nothing built yet. the first token takes the first parcel by the square.
            </p>
          ) : null}
        </div>

        <div className={`pointer-events-auto flex flex-col items-stretch gap-2 sm:items-end ${selectedParcel ? "md:mr-[404px]" : ""}`}>
          {legend ? <TierLegend onClose={() => setLegend(false)} /> : null}
          <div className="mc-panel scroll-thin flex max-w-full items-center gap-2 overflow-x-auto px-2 py-2" data-stats>
            <Stat label={parcels.length === 1 ? "building" : "buildings"} value={data ? String(parcels.length) : "…"} />
            <Stat label="traded" value={data ? eth(data.totalVolume) : "…"} sub={data?.ethUsd ? usd(data.totalVolume * data.ethUsd) : undefined} />
            <Stat label={data?.graduated === 1 ? "landmark" : "landmarks"} value={data ? String(data.graduated) : "…"} gold />
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => setLegend((v) => !v)} data-legend-toggle aria-expanded={legend}>
              levels
            </button>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => sceneRef.current?.fitCity(true)} aria-label="Fit the whole city" data-fit>
              fit
            </button>
          </div>
        </div>
      </div>

      {/* hover tooltip */}
      {hovered && !selectedParcel ? (
        <div className="pointer-events-none absolute z-20 mc-panel px-3 py-2" style={{ left: hover!.x + 14, top: hover!.y + 14 }} data-tooltip>
          <p className="pixel text-[15px] leading-none text-outline">${hovered.symbol}</p>
          <p className="mt-1 text-[12px] text-ink-2">
            {TIERS[hovered.level.tier].label.toLowerCase()}
            {hovered.level.floors > 0 ? ` · ${hovered.level.floors} fl` : ""} · {eth(hovered.activity.volume)} traded
          </p>
        </div>
      ) : null}

      {/* reading state */}
      {!data ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <p className="pixel pixel-shadow text-[18px] text-white">{city.isError ? "the chain did not answer. retrying…" : "reading the chain…"}</p>
        </div>
      ) : null}
      {data?.error ? (
        <p className="pixel pixel-shadow pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 text-[12px] text-white" data-read-error>
          last read failed ({data.error.slice(0, 60)}) — showing the previous one
        </p>
      ) : null}
      {!webgl ? (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 mc-panel mc-panel-pad max-w-sm">
          <p className="pixel text-[18px] text-outline">no webgl here.</p>
          <p className="mt-2 text-[13px] text-ink-2">the city needs it. the launch page and the parcel pages still work.</p>
        </div>
      ) : null}

      {selectedParcel ? (
        <ParcelSheet
          parcel={selectedParcel}
          ethUsd={data?.ethUsd ?? null}
          onClose={() => select(null, false)}
          onNavigate={(href) => router.push(href)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub, gold = false }: { label: string; value: string; sub?: string; gold?: boolean }) {
  return (
    <div className="mc-slot flex min-w-[68px] shrink-0 flex-col px-2 py-1 sm:min-w-[76px]" data-stat={label}>
      <span className={`pixel num text-[16px] leading-none ${gold ? "text-gold" : ""}`}>{value}</span>
      <span className="pixel mt-1 text-[11px] leading-none text-[#e5e5e5]">
        {label}
        {sub ? <span className="text-[#c8c8c8]"> · {sub}</span> : null}
      </span>
    </div>
  );
}
