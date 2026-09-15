import type { Metadata } from "next";
import Link from "next/link";
import { TierStrip } from "@/components/city/TierLegend";
import { PageShell } from "@/components/PageShell";
import { PixelWordmark } from "@/components/PixelWordmark";
import { TIERS } from "@/lib/city/levels";
import { PONS_FACTORY } from "@/lib/contracts";
import { explorer } from "@/lib/chain";
import { MARKET } from "@/lib/marketDeploy";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `how it works — ${site.name}`,
  description: "Every token launched through Pixel Market gets a parcel in a voxel city. Buildings grow with traded volume; graduation makes a landmark.",
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "what exactly happens when i launch?",
    a: `one transaction to the ${site.name.toLowerCase()} contract. it calls pons v2 — the token factory on robinhood chain — which creates your erc-20 and its bonding curve. with a first buy, the launch goes through pons' forwarder so the buy is atomic and you are exempt from the launch snipe tax. then the contract records parcel #n: your token, curve, name, ticker, logo and description, on the chain.`,
  },
  {
    q: "what does it cost?",
    a: "pons' launch fee (0.0005 eth today, read live) plus your first buy if you make one, plus gas. pixel market takes nothing: no platform fee, no platform token, no cut of your creator fees.",
  },
  {
    q: "who gets the creator fees?",
    a: "you. pons pays the creator's share of every trade's 1% fee to the creator-fee recipient, and the contract sets that to your wallet. fees accrue on the curve and pons sweeps them to its escrow; the sheet shows what is claimable and lets you claim it.",
  },
  {
    q: "how is my building's height decided?",
    a: "from the curve's own CurveBuy and CurveSell logs: traded volume = every buy's eth in + every sell's eth out. the tier comes from the thresholds above; inside a tier the floor count keeps climbing with volume (log scale). graduation — the curve raising its threshold and moving to the pool — makes the building a landmark, whatever its volume.",
  },
  {
    q: "can a building shrink?",
    a: "no. volume only adds up. a token that stops trading keeps its building; it just stops growing.",
  },
  {
    q: "where does parcel #n stand?",
    a: "in launch order. the city is a grid of blocks, four parcels each, around the market square; blocks fill in a spiral, ring by ring. the chain stores the order, the site draws the map — parcel #n is always in the same place.",
  },
  {
    q: "can i pick my parcel, or buy someone else's?",
    a: "no. a parcel is the token's, not a thing you own or trade separately. the only market here is the token's own curve.",
  },
  {
    q: "is there an indexer or an api behind this?",
    a: "no. the site reads the market contract (one call for the whole register), every curve through multicall3, and the trade logs straight from the rpc. what you see is what the chain says, delayed by at most a few seconds.",
  },
  {
    q: "who runs the contract?",
    a: `nobody. it has no owner, no admin, no pause, no upgrade. its address is fixed by its code (create2 through the deterministic deployer on robinhood chain), so anyone can put it on the chain and everyone reads the same one: ${MARKET}.`,
  },
  {
    q: "what about tokens launched on pons directly?",
    a: "they have no parcel. the city only knows tokens launched through the pixel market contract, because that is what its register holds.",
  },
];

export default function HowPage() {
  return (
    <PageShell width="max-w-4xl">
      <div className="mc-panel mc-panel-pad">
        <PixelWordmark height={40} />
        <p className="pixel mt-4 text-[30px] leading-none text-outline">{site.hook}</p>
        <p className="prose-mc mt-3 max-w-2xl text-[15px] leading-relaxed text-ink">
          <span>
            every token launched through {site.name.toLowerCase()} gets a small parcel in a pixel city on robinhood chain. the token trades on its pons v2 bonding curve like any other; the more it trades, the taller its building grows. the city is a map of activity — drawn from the chain, never from a database.
          </span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/launch" className="mc-btn mc-btn-primary">
            launch a token
          </Link>
          <Link href="/" className="mc-btn">
            see the city
          </Link>
        </div>
      </div>

      <section className="mc-panel mc-panel-pad mt-3" data-section="steps">
        <span className="label">three steps</span>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ["1. launch", "name, ticker, logo, a line, an optional first buy. one transaction: pons v2 creates the token and its curve, the contract gives you the next parcel."],
            ["2. trade", "buys and sells on the curve, here or on pons. 1% fee per trade; the creator's share of it is yours, paid by pons."],
            ["3. grow", "traded volume moves the building up the tiers. graduation to the pool turns it into a landmark with gold on the roof."],
          ].map(([t, d]) => (
            <li key={t} className="mc-slot px-3 py-3">
              <p className="pixel text-[16px]">{t}</p>
              <p className="mt-1 text-[12px] leading-snug text-[#eeeeee]">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mc-panel mc-panel-pad mt-3" data-section="tiers">
        <span className="label">the eight tiers</span>
        <p className="mt-2 text-[13px] text-ink-2">traded volume = every buy&apos;s eth in + every sell&apos;s eth out, read from the curve&apos;s logs. same numbers in the city, the sheet and the contract&apos;s readme.</p>
        <div className="mt-3">
          <TierStrip />
        </div>
        <table className="mono mt-4 w-full text-[12px]">
          <thead>
            <tr className="text-left text-ink-2">
              <th className="pb-1 font-normal">tier</th>
              <th className="pb-1 font-normal">unlocked at</th>
              <th className="pb-1 font-normal">floors</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t.key} className="border-t border-bevel-dark/40">
                <td className="py-1 pixel text-[13px]">{t.label.toLowerCase()}</td>
                <td className="py-1">{t.key === "lot" ? "launch" : t.key === "landmark" ? "graduation" : `${t.minVolume} eth traded`}</td>
                <td className="py-1">{t.floors[0] === t.floors[1] ? t.floors[0] : `${t.floors[0]}–${t.floors[1]}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mc-panel mc-panel-pad mt-3" data-section="faq">
        <span className="label">questions</span>
        <dl className="mt-3 flex flex-col gap-4">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="pixel text-[16px] text-outline">{f.q}</dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-ink">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mc-panel mc-panel-pad mt-3" data-section="facts">
        <span className="label">the chain</span>
        <ul className="mono mt-2 flex flex-col gap-1 text-[12px] text-ink">
          <li>robinhood chain · chain id 4663 · eth</li>
          <li>
            pons v2 factory{" "}
            <a href={explorer.address(PONS_FACTORY)} target="_blank" rel="noreferrer" className="underline">
              {PONS_FACTORY}
            </a>
          </li>
          <li>
            pixel market{" "}
            <a href={explorer.address(MARKET)} target="_blank" rel="noreferrer" className="underline">
              {MARKET}
            </a>{" "}
            ·{" "}
            <Link href="/deploy" className="underline">
              deploy it
            </Link>
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
