import type { Metadata } from "next";
import { DeployMarket } from "@/components/DeployMarket";
import { PageShell } from "@/components/PageShell";
import bytecodeRecord from "@/lib/abi/PixelMarket.bytecode.json";
import { explorer } from "@/lib/chain";
import { PONS_FACTORY } from "@/lib/contracts";
import { DETERMINISTIC_DEPLOYER, MARKET, MARKET_SALT, marketInitCodeHash } from "@/lib/marketDeploy";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `deploy the market — ${site.name}`,
  description: "The Pixel Market contract has a deterministic address on Robinhood Chain. Anyone can deploy it with one transaction.",
};

export default function DeployPage() {
  const codeBytes = (bytecodeRecord.bytecode.length - 2) / 2;
  return (
    <PageShell>
      <div className="mc-panel mc-panel-pad">
        <span className="label">the contract</span>
        <p className="pixel mt-2 text-[28px] leading-none text-outline">one contract, one address, anyone&apos;s wallet.</p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">
          the market is created with create2 through the deterministic deployer that lives on robinhood chain, from the exact bytecode this site embeds and its one constructor argument, the pons factory. same inputs, same address, whoever sends the transaction. nobody holds a key for it: no owner, no admin, no fee switch.
        </p>
        <div className="mt-4">
          <DeployMarket />
        </div>
      </div>

      <div className="mc-panel mc-panel-pad mt-3">
        <span className="label">what fixes the address</span>
        <dl className="mono mt-2 grid gap-2 text-[12px] text-ink sm:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="text-ink-2">market</dt>
          <dd className="break-all">
            <a href={explorer.address(MARKET)} target="_blank" rel="noreferrer" className="underline">
              {MARKET}
            </a>
          </dd>
          <dt className="text-ink-2">deployer proxy</dt>
          <dd className="break-all">
            <a href={explorer.address(DETERMINISTIC_DEPLOYER)} target="_blank" rel="noreferrer" className="underline">
              {DETERMINISTIC_DEPLOYER}
            </a>
          </dd>
          <dt className="text-ink-2">salt</dt>
          <dd className="break-all">{MARKET_SALT}</dd>
          <dt className="text-ink-2">init code hash</dt>
          <dd className="break-all">{marketInitCodeHash()}</dd>
          <dt className="text-ink-2">constructor</dt>
          <dd className="break-all">factory = {PONS_FACTORY}</dd>
          <dt className="text-ink-2">compiler</dt>
          <dd>
            solc {bytecodeRecord.solcVersion} · optimizer {bytecodeRecord.optimizer?.enabled ? `on, ${bytecodeRecord.optimizer.runs} runs` : "off"} · via-ir {bytecodeRecord.viaIR ? "on" : "off"} · {codeBytes} bytes of creation code
          </dd>
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          any change to the source, the compiler settings or the factory address is a different address, never a silent swap. the same transaction can be sent from the command line: <span className="mono">cd contracts && npm run deploy:robinhood</span>.
        </p>
      </div>
    </PageShell>
  );
}
