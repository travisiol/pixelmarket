// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPonsFactoryV2, IPonsLaunchForwarder} from "./interfaces/IPonsV2.sol";

/**
 * Pixel Market — every token launched through here gets a parcel in the
 * pixel city.
 *
 * A launch is Pons V2's own launch on Robinhood Chain (the factory creates
 * the token and its bonding curve; with a first buy it goes through Pons'
 * forwarder so the buy is atomic and the creator is exempt from the snipe
 * tax). The caller is the creator-fee recipient: Pons pays them the
 * creator fees, natively. This contract keeps nothing — no platform fee,
 * no platform token, no owner, no admin.
 *
 * What it adds is the register: parcel #n is the n-th token launched here,
 * with its name, ticker, logo and description stored on the chain so the
 * city can be drawn from a single call, with no indexer. Where parcel #n
 * stands in the city, and how tall its building is, are derived by the
 * site from the parcel number and the curve's trading activity — the
 * chain is the source, the city is the view.
 */
contract PixelMarket is ReentrancyGuard {
    struct Parcel {
        address token;
        address curve;
        address creator;
        /// block.timestamp of the launch.
        uint64 launchedAt;
        /// block.number of the launch — where log scans for this curve start.
        uint64 launchBlock;
        string name;
        string symbol;
        string logo;
        string description;
    }

    /// A parcel with its number, for snapshot().
    struct Entry {
        uint256 parcelId;
        Parcel parcel;
    }

    IPonsFactoryV2 public immutable factory;
    IPonsLaunchForwarder public immutable forwarder;

    /// ETH-paired curves only: volume, fees and levels are all in ETH.
    address public constant PAIR_TOKEN = address(0);

    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_SYMBOL_BYTES = 16;
    uint256 public constant MAX_LOGO_BYTES = 256;
    uint256 public constant MAX_DESCRIPTION_BYTES = 600;
    uint256 public constant MAX_SOCIAL_BYTES = 200;

    Parcel[] private _parcels;
    /// token → parcel id + 1 (0 = not launched here).
    mapping(address token => uint256 idPlusOne) private _parcelOf;

    event ParcelBuilt(
        uint256 indexed parcelId,
        address indexed token,
        address indexed creator,
        address curve,
        string name,
        string symbol,
        uint256 buyAmount
    );

    error ZeroAddress();
    error EmptyName();
    error EmptySymbol();
    error TooLong(string field, uint256 max);
    error WrongValue(uint256 expected, uint256 sent);
    error UnknownParcel(uint256 parcelId);

    constructor(IPonsFactoryV2 factory_) {
        if (address(factory_) == address(0)) revert ZeroAddress();
        factory = factory_;
        forwarder = IPonsLaunchForwarder(factory_.launchForwarder());
        if (address(forwarder) == address(0)) revert ZeroAddress();
    }

    // ───────────────────────────────────────────── launch ──

    /**
     * Launch a token on Pons V2 and take the next parcel.
     *
     * Send `factory.launchFee() + buyAmount` wei. With `buyAmount > 0` the
     * launch goes through Pons' forwarder: token, curve and the first buy
     * in one transaction, the tokens delivered to the caller, who is
     * exempt from the snipe tax. With `buyAmount == 0` the factory is
     * called directly and the curve opens with nobody in it.
     *
     * `creatorTaxBps` is an optional tax on every trade, paid to the
     * caller on top of Pons' creator fees (0–1000, the factory's cap).
     * `configId` is Pons' launch config (0 today). `minTokensOut` guards
     * the first buy; the curve does not exist before this transaction,
     * so 0 is safe.
     */
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata logo,
        string calldata description,
        string[5] calldata socials,
        uint16 creatorTaxBps,
        uint256 configId,
        uint256 buyAmount,
        uint256 minTokensOut
    ) external payable nonReentrant returns (uint256 parcelId, address token, address curve) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (bytes(name).length > MAX_NAME_BYTES) revert TooLong("name", MAX_NAME_BYTES);
        if (bytes(symbol).length > MAX_SYMBOL_BYTES) revert TooLong("symbol", MAX_SYMBOL_BYTES);
        if (bytes(logo).length > MAX_LOGO_BYTES) revert TooLong("logo", MAX_LOGO_BYTES);
        if (bytes(description).length > MAX_DESCRIPTION_BYTES) revert TooLong("description", MAX_DESCRIPTION_BYTES);
        for (uint256 i = 0; i < 5; i++) {
            if (bytes(socials[i]).length > MAX_SOCIAL_BYTES) revert TooLong("social", MAX_SOCIAL_BYTES);
        }

        uint256 fee = factory.launchFee();
        uint256 expected = fee + buyAmount;
        if (msg.value != expected) revert WrongValue(expected, msg.value);

        parcelId = _parcels.length;

        IPonsFactoryV2.LaunchParams memory params = IPonsFactoryV2.LaunchParams({
            name: name,
            symbol: symbol,
            logo: logo,
            description: description,
            socials: IPonsFactoryV2.Socials({
                x: socials[0],
                telegram: socials[1],
                website: socials[2],
                discord: socials[3],
                extra: socials[4]
            }),
            creatorFeeRecipient: msg.sender,
            creatorTaxBps: creatorTaxBps,
            buybackEnabled: true,
            economicsHash: factory.previewLaunchEconomics(configId, PAIR_TOKEN),
            // Unique per launch: the factory mixes the sender into CREATE2,
            // and through the forwarder every launcher shares that sender.
            salt: keccak256(abi.encode(address(this), parcelId, msg.sender, block.chainid))
        });
        address[] memory exempt = new address[](0);

        if (buyAmount > 0) {
            (token, curve) = forwarder.launchAndBuy{value: msg.value}(
                params,
                configId,
                PAIR_TOKEN,
                buyAmount,
                minTokensOut,
                msg.sender,
                exempt
            );
        } else {
            (token, curve) = factory.launchToken{value: msg.value}(params, configId, PAIR_TOKEN, exempt);
        }

        _parcels.push(
            Parcel({
                token: token,
                curve: curve,
                creator: msg.sender,
                launchedAt: uint64(block.timestamp),
                launchBlock: uint64(block.number),
                name: name,
                symbol: symbol,
                logo: logo,
                description: description
            })
        );
        _parcelOf[token] = parcelId + 1;
        emit ParcelBuilt(parcelId, token, msg.sender, curve, name, symbol, buyAmount);
    }

    // ───────────────────────────────────────────── views ──

    function parcelCount() external view returns (uint256) {
        return _parcels.length;
    }

    function parcels(uint256 parcelId) external view returns (Parcel memory) {
        if (parcelId >= _parcels.length) revert UnknownParcel(parcelId);
        return _parcels[parcelId];
    }

    /// (true, id) when the token was launched here.
    function parcelOf(address token) external view returns (bool exists, uint256 parcelId) {
        uint256 v = _parcelOf[token];
        return v == 0 ? (false, 0) : (true, v - 1);
    }

    /// Parcels [offset, offset + limit), oldest first — one call for a city page.
    function snapshot(uint256 offset, uint256 limit) external view returns (Entry[] memory page) {
        uint256 n = _parcels.length;
        if (offset >= n) return new Entry[](0);
        uint256 end = offset + limit;
        if (end > n || end < offset) end = n;
        page = new Entry[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = Entry({parcelId: i, parcel: _parcels[i]});
        }
    }

    /// Pons' current launch fee, so a front end can size msg.value.
    function launchFee() external view returns (uint256) {
        return factory.launchFee();
    }
}
