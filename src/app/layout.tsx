import type { Metadata, Viewport } from "next";
import { Inter, Pixelify_Sans } from "next/font/google";
import Script from "next/script";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { site } from "@/lib/site";

const pixel = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: `${site.name} — ${site.hook}`,
  description: site.description,
  metadataBase: new URL(site.url),
  openGraph: { title: `${site.name} — ${site.hook}`, description: site.description, type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#7fb2ff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${pixel.variable} ${inter.variable} h-full`}>
      <head>
        {/* rehearsal only: a stub wallet that lets the seeded fork sign (public/dev-wallet.js) */}
        {process.env.NEXT_PUBLIC_DEV_WALLET === "1" && process.env.NODE_ENV !== "production" ? <Script src="/dev-wallet.js" strategy="beforeInteractive" /> : null}
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
