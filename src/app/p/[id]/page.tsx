import type { Metadata } from "next";
import { CityView } from "@/components/city/CityView";
import { site } from "@/lib/site";

/** A parcel's permalink: the city, centred on it, with its sheet open. */
export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `parcel #${id} — ${site.name}` };
}

export default async function ParcelPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const n = Number.parseInt(id, 10);
  return <CityView initialParcel={Number.isInteger(n) && n >= 0 ? n : null} />;
}
