import * as fs from "node:fs";
import * as path from "node:path";
import type { NextConfig } from "next";

/**
 * wagmi's Base Account connector dynamically imports `@base-org/account`,
 * whose Node build reaches for optional `@x402/*` payment packages that are
 * not installed and never executed here. The bundler still tries to resolve
 * them, so they are aliased away (webpack: false, Turbopack: src/lib/empty.cjs,
 * a CommonJS stub whose exports are not statically known).
 */
const OPTIONAL_MODULES = [
  "@x402/core",
  "@x402/core/client",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/svm",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/fetch",
];

/**
 * The market's address is deterministic (src/lib/marketDeploy.ts) and
 * normally needs no configuration. NEXT_PUBLIC_MARKET, or the record
 * contracts/scripts/deploy.ts writes, only override it — for pointing the
 * site at another deployment on purpose.
 */
function deployedMarket(): string | undefined {
  if (process.env.NEXT_PUBLIC_MARKET?.trim()) return undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  const file = path.join(process.cwd(), "contracts", "deployments", "robinhood.json");
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as { chainId?: number; market?: string };
    if (Number(record.chainId) === chainId && typeof record.market === "string" && /^0x[0-9a-fA-F]{40}$/.test(record.market)) {
      return record.market;
    }
  } catch {
    /* no deployment record yet */
  }
  return undefined;
}

const market = deployedMarket();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: market ? { NEXT_PUBLIC_MARKET: market } : {},
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(OPTIONAL_MODULES.map((name) => [name, false])),
    };
    return config;
  },
  turbopack: {
    resolveAlias: Object.fromEntries(OPTIONAL_MODULES.map((name) => [name, "./src/lib/empty.cjs"])),
  },
};

export default nextConfig;
