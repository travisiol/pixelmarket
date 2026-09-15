"use client";

import { ConnectButton as RainbowConnect } from "@rainbow-me/rainbowkit";
import { shortAddress } from "@/lib/format";

/** RainbowKit's modal behind the site's own button. */
export function ConnectButton({ size = "sm", full = false }: { size?: "sm" | "md"; full?: boolean }) {
  const cls = `mc-btn ${size === "sm" ? "mc-btn-sm" : ""} ${full ? "w-full" : ""}`;
  return (
    <RainbowConnect.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!ready) {
          return (
            <button type="button" className={cls} disabled aria-hidden>
              connect
            </button>
          );
        }
        if (!connected) {
          return (
            <button type="button" className={cls} onClick={openConnectModal} data-connect>
              connect wallet
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" className={`${cls} mc-btn-gold`} onClick={openChainModal}>
              switch to robinhood chain
            </button>
          );
        }
        return (
          <button type="button" className={cls} onClick={openAccountModal} data-account>
            <span className="inline-block h-2 w-2 bg-emerald" />
            {shortAddress(account.address)}
          </button>
        );
      }}
    </RainbowConnect.Custom>
  );
}
