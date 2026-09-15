// Screenshots of the site with headless Chrome + SwiftShader (WebGL without
// a GPU), for the README and for looking at the city without a browser
// pane: `node scripts/capture.mjs [baseUrl] [outDir]`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3870";
const out = process.argv[3] ?? join(process.cwd(), "captures");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
if (!chrome) throw new Error("chrome.exe not found");
mkdirSync(out, { recursive: true });

const shots = [
  ["city", "/", 1440, 900],
  ["parcel", "/p/8", 1440, 900],
  ["launch", "/launch", 1440, 1100],
  ["how", "/how", 1440, 2600],
  ["city-phone", "/", 400, 860],
];

for (const [name, path, w, h] of shots) {
  const file = join(out, `${name}.png`);
  execFileSync(chrome, [
    "--headless=new",
    "--no-first-run",
    `--user-data-dir=${join(tmpdir(), "pixelmarket-shot")}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    `--window-size=${w},${h}`,
    "--virtual-time-budget=20000",
    `--screenshot=${file}`,
    `${base}${path}`,
  ], { stdio: "ignore", timeout: 120_000 });
  console.log(`wrote ${file}`);
}
