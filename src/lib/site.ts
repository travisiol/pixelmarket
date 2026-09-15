/**
 * The name lives here and nowhere else. Change it once to rebrand.
 */
export const site = {
  name: "PIXEL MARKET",
  wordmark: "PIXEL MARKET",
  slug: "pixelmarket",
  hook: "Build your market.",
  tagline: "Every token launched here gets a parcel in the pixel city.",
  description:
    "Launch a token on Robinhood Chain and take a parcel in the pixel city. The more your token trades, the taller its building grows.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://pixelmarket.example",
  x: process.env.NEXT_PUBLIC_X_URL ?? "",
  /** Where trading also happens, per token. */
  ponsTokenUrl: (token: string) => `https://www.ponsfamily.com/launchpad/${token}`,
} as const;
