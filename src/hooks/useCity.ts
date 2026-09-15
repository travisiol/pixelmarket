"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { CityJson, ParcelDetailJson } from "@/lib/types";

const REFRESH_MS = 15_000;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return (await r.json()) as T;
}

/** The whole city, re-read every 15 s. The server reads the chain once for everyone. */
export function useCity() {
  return useQuery<CityJson>({
    queryKey: ["city"],
    queryFn: () => fetchJson<CityJson>("/api/city"),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

/** Holders, trades, escrow — for one open sheet. */
export function useParcelDetail(id: number | null) {
  return useQuery<ParcelDetailJson>({
    queryKey: ["parcel", id],
    queryFn: () => fetchJson<ParcelDetailJson>(`/api/parcel/${id}`),
    enabled: id !== null,
    refetchInterval: REFRESH_MS,
  });
}

const noop = () => () => {};
/** false during SSR and hydration, true once the client owns the tree. */
export const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
