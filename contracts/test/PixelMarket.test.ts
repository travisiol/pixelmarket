import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE, marketDeployTx, predictedMarket } from "../../src/lib/marketDeploy";

const NO_SOCIALS: [string, string, string, string, string] = ["", "", "", "", ""];

/**
 * PixelMarket against the Pons mock. What the real factory does with the
 * same calls is proven separately on a fork (scripts/fork-check.ts).
 */
describe("PixelMarket", () => {
  async function deploy() {
    const [deployer, alice, bob, carol] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("MockPonsFactory")).deploy(deployer.address);
    await factory.waitForDeployment();
    const market = await (await ethers.getContractFactory("PixelMarket")).deploy(await factory.getAddress());
    await market.waitForDeployment();
    const fee = await factory.launchFee();
    return { deployer, alice, bob, carol, factory, market, fee };
  }

  const launch = (
    market: Awaited<ReturnType<typeof deploy>>["market"],
    who: Awaited<ReturnType<typeof deploy>>["alice"],
    fee: bigint,
    buy: bigint,
    overrides: Partial<{ name: string; symbol: string; logo: string; description: string; tax: number; value: bigint }> = {},
  ) =>
    market
      .connect(who)
      .launch(
        overrides.name ?? "Pixel Coin",
        overrides.symbol ?? "PXL",
        overrides.logo ?? "ipfs://logo",
        overrides.description ?? "a coin with a parcel",
        NO_SOCIALS,
        overrides.tax ?? 0,
        0,
        buy,
        0,
        { value: overrides.value ?? fee + buy },
      );

  it("wires the factory and its forwarder, and keeps nothing", async () => {
    const { market, factory } = await deploy();
    expect(await market.factory()).to.equal(await factory.getAddress());
    expect(await market.forwarder()).to.equal(await factory.launchForwarder());
    expect(await market.PAIR_TOKEN()).to.equal(ethers.ZeroAddress);
    expect(await market.launchFee()).to.equal(await factory.launchFee());
    expect(await market.parcelCount()).to.equal(0);
  });

  it("launches with a first buy through the forwarder and records parcel #0 for the caller", async () => {
    const { market, factory, alice, fee } = await deploy();
    const buy = ethers.parseEther("0.01");
    const tx = await launch(market, alice, fee, buy);
    const receipt = await tx.wait();
    const p = await market.parcels(0);
    expect(p.token).to.not.equal(ethers.ZeroAddress);
    expect(p.curve).to.not.equal(ethers.ZeroAddress);
    expect(p.creator).to.equal(alice.address);
    expect(p.name).to.equal("Pixel Coin");
    expect(p.symbol).to.equal("PXL");
    expect(p.logo).to.equal("ipfs://logo");
    expect(p.description).to.equal("a coin with a parcel");
    expect(p.launchBlock).to.equal(BigInt(receipt!.blockNumber));
    expect(await market.parcelCount()).to.equal(1);
    await expect(tx).to.emit(market, "ParcelBuilt").withArgs(0, p.token, alice.address, p.curve, "Pixel Coin", "PXL", buy);

    // The caller is the creator-fee recipient and got the first tokens; the market holds nothing.
    const curve = await ethers.getContractAt("MockCurve", p.curve);
    const token = await ethers.getContractAt("MockLaunchedToken", p.token);
    expect(await curve.deployer()).to.equal(alice.address);
    expect(await token.balanceOf(alice.address)).to.be.gt(0n);
    expect(await token.balanceOf(await market.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
    expect(await curve.snipeTaxExempt(alice.address)).to.equal(true);
    const forwarder = await ethers.getContractAt("MockLaunchForwarder", await factory.launchForwarder());
    expect(await forwarder.lastBuyRecipient()).to.equal(alice.address);
    expect((await factory.lastParams()).creatorFeeRecipient).to.equal(alice.address);
    expect(await factory.lastLauncher()).to.equal(await forwarder.getAddress());
  });

  it("launches without a first buy straight through the factory", async () => {
    const { market, factory, alice, fee } = await deploy();
    await (await launch(market, alice, fee, 0n)).wait();
    const p = await market.parcels(0);
    const curve = await ethers.getContractAt("MockCurve", p.curve);
    const token = await ethers.getContractAt("MockLaunchedToken", p.token);
    expect(await curve.deployer()).to.equal(alice.address);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
    expect(await factory.lastLauncher()).to.equal(await market.getAddress());
    expect(await curve.realQuoteReserve()).to.equal(0n);
  });

  it("numbers parcels in launch order and finds them by token", async () => {
    const { market, alice, bob, carol, fee } = await deploy();
    await (await launch(market, alice, fee, 0n, { symbol: "AAA", name: "A" })).wait();
    await (await launch(market, bob, fee, ethers.parseEther("0.02"), { symbol: "BBB", name: "B" })).wait();
    await (await launch(market, carol, fee, 0n, { symbol: "CCC", name: "C" })).wait();
    expect(await market.parcelCount()).to.equal(3);
    const b = await market.parcels(1);
    expect(b.symbol).to.equal("BBB");
    expect(b.creator).to.equal(bob.address);
    const [exists, id] = await market.parcelOf(b.token);
    expect(exists).to.equal(true);
    expect(id).to.equal(1);
    const [missing] = await market.parcelOf(alice.address);
    expect(missing).to.equal(false);
    await expect(market.parcels(3)).to.be.revertedWithCustomError(market, "UnknownParcel").withArgs(3);
  });

  it("pages the snapshot oldest first", async () => {
    const { market, alice, fee } = await deploy();
    for (let i = 0; i < 5; i++) await (await launch(market, alice, fee, 0n, { symbol: `T${i}`, name: `token ${i}` })).wait();
    const all = await market.snapshot(0, 100);
    expect(all.length).to.equal(5);
    expect(all.map((e) => Number(e.parcelId))).to.deep.equal([0, 1, 2, 3, 4]);
    expect(all[2].parcel.symbol).to.equal("T2");
    const page = await market.snapshot(3, 2);
    expect(page.map((e) => Number(e.parcelId))).to.deep.equal([3, 4]);
    const tail = await market.snapshot(4, 100);
    expect(tail.length).to.equal(1);
    expect((await market.snapshot(5, 10)).length).to.equal(0);
    expect((await market.snapshot(0, 0)).length).to.equal(0);
  });

  it("gives every launch its own salt, so the same creator can launch twice", async () => {
    const { market, factory, alice, fee } = await deploy();
    await (await launch(market, alice, fee, 0n, { symbol: "ONE" })).wait();
    const salt1 = (await factory.lastParams()).salt;
    await (await launch(market, alice, fee, 0n, { symbol: "TWO" })).wait();
    const salt2 = (await factory.lastParams()).salt;
    expect(salt1).to.not.equal(salt2);
    const a = await market.parcels(0);
    const b = await market.parcels(1);
    expect(a.token).to.not.equal(b.token);
  });

  it("passes the creator tax through to the curve", async () => {
    const { market, alice, fee } = await deploy();
    await (await launch(market, alice, fee, ethers.parseEther("0.01"), { tax: 250 })).wait();
    const p = await market.parcels(0);
    const curve = await ethers.getContractAt("MockCurve", p.curve);
    expect(await curve.creatorTaxBps()).to.equal(250);
  });

  it("refuses a wrong value, an empty name or ticker, and oversized fields", async () => {
    const { market, alice, fee } = await deploy();
    const buy = ethers.parseEther("0.01");
    await expect(launch(market, alice, fee, buy, { value: fee }))
      .to.be.revertedWithCustomError(market, "WrongValue")
      .withArgs(fee + buy, fee);
    await expect(launch(market, alice, fee, 0n, { value: fee + 1n }))
      .to.be.revertedWithCustomError(market, "WrongValue")
      .withArgs(fee, fee + 1n);
    await expect(launch(market, alice, fee, 0n, { name: "" })).to.be.revertedWithCustomError(market, "EmptyName");
    await expect(launch(market, alice, fee, 0n, { symbol: "" })).to.be.revertedWithCustomError(market, "EmptySymbol");
    await expect(launch(market, alice, fee, 0n, { symbol: "A".repeat(17) }))
      .to.be.revertedWithCustomError(market, "TooLong")
      .withArgs("symbol", 16);
    await expect(launch(market, alice, fee, 0n, { name: "N".repeat(65) }))
      .to.be.revertedWithCustomError(market, "TooLong")
      .withArgs("name", 64);
    await expect(launch(market, alice, fee, 0n, { logo: "x".repeat(257) }))
      .to.be.revertedWithCustomError(market, "TooLong")
      .withArgs("logo", 256);
    await expect(launch(market, alice, fee, 0n, { description: "d".repeat(601) }))
      .to.be.revertedWithCustomError(market, "TooLong")
      .withArgs("description", 600);
    expect(await market.parcelCount()).to.equal(0);
  });

  it("refuses a zero factory", async () => {
    const f = await ethers.getContractFactory("PixelMarket");
    await expect(f.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(f, "ZeroAddress");
  });

  it("emits Pons-shaped CurveBuy / CurveSell on the mock curve, which is what the city reads", async () => {
    const { market, alice, bob, fee } = await deploy();
    await (await launch(market, alice, fee, ethers.parseEther("0.01"))).wait();
    const p = await market.parcels(0);
    const curve = await ethers.getContractAt("MockCurve", p.curve);
    const token = await ethers.getContractAt("MockLaunchedToken", p.token);
    const spend = ethers.parseEther("0.05");
    await expect(curve.connect(bob).buy(spend, 0, bob.address, { value: spend })).to.emit(curve, "CurveBuy");
    const bal = await token.balanceOf(bob.address);
    await (await token.connect(bob).approve(p.curve, bal / 2n)).wait();
    await expect(curve.connect(bob).sell(bal / 2n, 0, bob.address)).to.emit(curve, "CurveSell");
    const buys = await curve.queryFilter(curve.filters.CurveBuy());
    const sells = await curve.queryFilter(curve.filters.CurveSell());
    // The launch's own first buy counts as activity too.
    expect(buys.length).to.equal(2);
    expect(sells.length).to.equal(1);
  });

  it("lands at the predicted address through the deterministic deployer, once", async () => {
    const { factory, alice, fee } = await deploy();
    const factoryAddr = (await factory.getAddress()) as `0x${string}`;
    await network.provider.send("hardhat_setCode", [DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE]);
    const expected = predictedMarket(factoryAddr);
    expect(await ethers.provider.getCode(expected)).to.equal("0x");
    const tx = marketDeployTx(factoryAddr);
    await (await alice.sendTransaction({ to: tx.to, data: tx.data })).wait();
    expect(await ethers.provider.getCode(expected)).to.not.equal("0x");
    const market = await ethers.getContractAt("PixelMarket", expected);
    expect(await market.factory()).to.equal(factoryAddr);
    await expect(alice.sendTransaction({ to: tx.to, data: tx.data })).to.be.reverted;
    // And it works like any other instance.
    await (await launch(market, alice, fee, ethers.parseEther("0.01"))).wait();
    expect(await market.parcelCount()).to.equal(1);
  });
});
