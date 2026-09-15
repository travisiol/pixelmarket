# PIXEL MARKET — build your market.

Every token launched through Pixel Market gets a small parcel in a voxel
city on Robinhood Chain. The token trades on its Pons V2 bonding curve like
any other; the more it trades, the taller its building grows. Graduation
turns it into a landmark with gold on the roof.

The city is drawn from the chain — the market's own register, every curve,
and the curves' trade logs — never from a database.

## How it works

1. **Launch** (`/launch`): name, ticker, logo, a line, an optional first
   buy. One transaction to the `PixelMarket` contract, which calls Pons V2:
   the factory creates the ERC-20 and its bonding curve (through Pons'
   forwarder when there is a first buy, so the buy is atomic and the
   creator is exempt from the launch snipe tax). The contract then records
   parcel #n — token, curve, creator, name, ticker, logo, description — on
   the chain.
2. **Trade**: buys and sells on the curve, from the parcel's sheet or on
   Pons. 1 % fee per trade; the creator's share is paid to the creator by
   Pons. Pixel Market keeps nothing: no platform fee, no platform token,
   no cut of creator fees, no owner.
3. **Grow**: traded volume (every buy's ETH in + every sell's ETH out, read
   from the curve's `CurveBuy` / `CurveSell` logs) moves the building up
   the tiers. Inside a tier the floor count keeps climbing with volume
   (log scale). Volume only adds up, so a building never shrinks.

| tier | unlocked at | floors |
| --- | --- | --- |
| lot | launch | 0 |
| shack | 0.01 ETH traded | 1 |
| house | 0.05 ETH | 2–3 |
| shop | 0.2 ETH | 3–4 |
| tower | 0.6 ETH | 5–7 |
| highrise | 1.5 ETH | 8–11 |
| skyscraper | 3.5 ETH | 12–18 |
| landmark | graduation | 18–22 |

The numbers live in one place, `src/lib/city/levels.ts`; the city, the
sheet, `/how` and this table all read it.

**Where parcel #n stands** (`src/lib/city/layout.ts`): the city is a grid
of blocks, 2 × 2 parcels each, separated by streets, around the market
square (block 0,0). Blocks fill in a spiral, ring by ring, in launch order.
Pure functions of the parcel number — the chain stores the order, the site
draws the map.

## The contract

`contracts/contracts/PixelMarket.sol` — 7 266 bytes of creation code, no
owner, no admin, no pause, no upgrade. ETH-paired curves only.

- `launch(name, symbol, logo, description, socials[5], creatorTaxBps,
  configId, buyAmount, minTokensOut) payable → (parcelId, token, curve)`.
  Send `factory.launchFee() + buyAmount`. `buyAmount > 0` goes through
  Pons' `launchAndBuy`; `0` goes straight to `factory.launchToken`. The
  caller is the creator-fee recipient. Every launch has its own CREATE2
  salt (the factory mixes the sender in; through the forwarder every
  launcher shares it).
- `parcelCount()`, `parcels(id)`, `parcelOf(token) → (exists, id)`,
  `snapshot(offset, limit)` (oldest first), `launchFee()`.
- Event `ParcelBuilt(parcelId, token, creator, curve, name, symbol,
  buyAmount)`.

**Deterministic address.** The market is created with CREATE2 through
Arachnid's deterministic-deployment proxy (`0x4e59…956C`, present on
Robinhood Chain) from the exact creation bytecode hardhat exports to
`src/lib/abi/PixelMarket.bytecode.json` plus its one constructor argument,
the Pons factory. Same inputs, same address, whoever sends the transaction:

```
0xf3b8a1Fd17e65c91cb6E7cc0Ab9Aa97B448E88C5
```

Nothing to configure: the site reads that address and checks whether the
code is there. Until it is, the city is empty and every page offers to
deploy it — one transaction, gas only (≈ 1.57 M), from any wallet
(`/deploy`) or from the command line (`cd contracts && npm run
deploy:robinhood` with `DEPLOYER_PRIVATE_KEY` in `contracts/.env`). Any
change to the source, the compiler settings or the factory address is a
different address, never a silent swap — `/deploy` lists what fixes it.

### Proven on a fork of Robinhood Chain

`contracts/scripts/fork-check.ts` against the **real** Pons V2 factory
(`FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check`,
block 63 567 074):

- the market lands at the predicted address through the on-chain proxy;
  a second attempt reverts;
- launch with a first buy of 0.01 ETH: parcel #0 recorded, the caller is
  `curve.deployer()` and received 5 858 334.812710811290608911 tokens —
  exactly the local constant-product quote; snipe-tax exempt; the market
  holds nothing afterwards (gas 3.93 M);
- launch with no first buy goes straight through the factory: an empty
  curve, the caller its deployer (gas 3.73 M);
- the same creator launches again (own salt, own token; creator tax 1 %
  passed through);
- `WrongValue` and `EmptyName` revert before anything is sent;
- a stranger's buy (0.05 ETH → 28 291 371.98 tokens) and sell match the
  local quote to the wei, and one address-filtered `getLogs` over three
  curves — the way the city reads activity — adds up to the traded volume
  exactly.

Unit tests (`npm test` in `contracts/`, 11 passing) cover the register,
paging, limits, the two launch paths, salts and the deterministic deploy
against a Pons mock whose curve emits the real `CurveBuy` / `CurveSell`
events.

## Run it

```bash
npm install && npm run dev            # http://localhost:3000
cd contracts && npm install && npm test
npm run check:city                    # layout, tiers, meshing, font — headless
```

Copy `.env.example` to `.env.local` as needed. Without a WalletConnect
project id only injected wallets are offered; without `PINATA_JWT` the
launch form takes an https logo URL instead of an upload.

### Rehearsal without a live deployment

```bash
cd contracts
HARDHAT_CHAIN_ID=4663 npm run serve:fork                     # Pons mock, stable
FORK_URL=https://rpc.mainnet.chain.robinhood.com HARDHAT_CHAIN_ID=4663 npm run serve:fork   # real factory, dies in minutes
```

Seeds one parcel per tier (plus a few small ones) on a network served at
`http://127.0.0.1:8686`, then point the site at it in `.env.local`
(`NEXT_PUBLIC_RPC_URL`, and `NEXT_PUBLIC_MARKET` in mock mode — the mock
factory has its own address, so the market's differs from the
deterministic one; the script prints both) and restart `next dev`. With
`NEXT_PUBLIC_DEV_WALLET=1`, `public/dev-wallet.js` installs a stub wallet
that lets the unlocked test account sign
(`localStorage.setItem("pixelmarket:dev-wallet", JSON.stringify({ rpc:
"http://127.0.0.1:8686", address: "0x7099…79C8" }))`). Launch, buy and
sell were played this way from the browser; `scripts/capture.mjs` takes
screenshots with headless Chrome.

### Deploy the site

A plain Next 16 app at the repo root: import the repo in Vercel as is.
`contracts/` is a separate package the build ignores. Set `PINATA_JWT`
and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` there if you have them.

## Design

Minecraft / voxel, daylight, one screen. No image files anywhere:

- the block textures are a 128 × 128 atlas painted at runtime
  (`src/lib/city/atlas.ts`, 49 tiles, nearest filtering);
- buildings are voxels meshed with only the exposed faces, shaded by
  direction like Minecraft blocks (`voxel.ts`, `buildings.ts`) — eight
  recipes, one per tier, from a lot with a sign to a landmark with a
  beacon;
- signs and the wordmark use a hand-drawn 5 × 7 bitmap font (`font.ts`),
  so the pixels of the site are the pixels of the world;
- the UI is the Minecraft GUI: bevelled stone panels, grey buttons that go
  blue-and-yellow on hover, inset slots, experience-bar progress. Pixelify
  Sans for headings, Inter for reading. One accent (emerald); gold only
  for graduation and selection.

Drag to pan, wheel or pinch to zoom, click a building for its sheet
(trade, numbers, creator, recent trades). `/p/<id>` is a parcel's
permalink.

## Open

- **The name and the domain** are placeholders (`src/lib/site.ts`).
- The market is not deployed yet — anyone can (see above). Nothing on
  the site is simulated: until then the city is empty and says so.
- The public RPC caps `getLogs`; the scanner splits ranges on failure and
  scans incrementally, but a very busy curve could take a couple of reads
  to catch up. Set `NEXT_PUBLIC_MARKET_BLOCK` to the deployment block to
  skip empty history.
- A graduated token's price is the curve's last price; the Uniswap v4
  pool is not read. Trading a graduated token happens on Pons.
- The creator's escrow balance shown in the sheet is Pons' figure for
  that wallet across all its tokens; fees still on the curve are swept by
  Pons at its own pace.
