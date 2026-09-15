import type { Metadata } from "next";
import { LaunchForm } from "@/components/launch/LaunchForm";
import { PageShell } from "@/components/PageShell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `launch a token — ${site.name}`,
  description: "One transaction on Robinhood Chain: Pons V2 creates the token and its curve, and the next parcel in the pixel city is yours.",
};

export default function LaunchPage() {
  return (
    <PageShell width="max-w-4xl">
      <LaunchForm />
    </PageShell>
  );
}
