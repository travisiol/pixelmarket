import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export default function NotFound() {
  return (
    <PageShell>
      <div className="mc-panel mc-panel-pad">
        <p className="pixel text-[28px] leading-none text-outline">nothing built here.</p>
        <p className="mt-2 text-[14px] text-ink-2">that page is an empty lot.</p>
        <Link href="/" className="mc-btn mt-4">
          back to the city
        </Link>
      </div>
    </PageShell>
  );
}
