// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IPriceFeed.sol";
import "../vendor/FullMath.sol";

/// @notice Minimal PancakeSwap V2 / Uniswap V2 pair interface — only what
/// the TWAP feed needs.
interface IPancakePairLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

/// @title PancakeV2TwapFeed — IPriceFeed from a PancakeSwap V2 pair TWAP
/// @notice Production price feed for StelixVault on BNB (and any V2 chain).
///
/// WHY THIS EXISTS: the vault speaks V2 natively, so on BNB the router
/// needs no adapter — but the price feed does. IPriceFeed requires
/// latestPrice() + twapPrice(token, window) in 18-decimal USD, and neither
/// a Chainlink Aggregator (latestRoundData only, 8 decimals, no TWAP) nor
/// a raw pair fits that interface. This contract is the BNB mirror of
/// UniswapV3TwapFeed: same interface, same 30-minute TWAP guarantee, but
/// built on V2 cumulative prices instead of V3 observations.
///
/// HOW IT WORKS: a V2 pair only stores its *latest* cumulative price, not
/// history, so the feed must snapshot it. Anyone (in practice the keeper)
/// calls update(token); that stores (cumulative, timestamp). twapPrice()
/// then returns the time-weighted mean between that snapshot and now, and
/// reverts unless at least `windowSeconds` have passed since the snapshot.
/// So the deploy flow is: setPair() -> update() -> wait 30 minutes ->
/// the vault's TWAP reads work. The keeper should call update() on its
/// normal schedule (at least once per TWAP window) so the average always
/// covers roughly the last window.
///
/// LIMITS (honest):
/// - A TWAP is only as good as the pair's liquidity. A thin pair can be
///   moved over 30 minutes at real cost, but not by a one-minute wick —
///   which is exactly the guarantee StelixVault needs.
/// - Cumulative prices only advance when the pair is traded (swap / mint /
///   burn). A pair with no trades gives a frozen price: check the pair
///   has real, recent volume before pointing the vault at it.
/// - twapPrice() reverts instead of returning a stale or spot price when
///   there is no snapshot, or the snapshot is younger than the window.
/// - This is NOT a Chainlink feed. If a token has a Chainlink feed on the
///   chain, a Chainlink adapter (latestRoundData scaled 8 -> 18 decimals)
///   is the alternative — but its twapPrice() would just return the latest
///   price, with no wick protection. Prefer this TWAP feed where a liquid
///   V2 pair exists.
///
/// CHAIN VALUES (verified 2026-11-27, BNB):
/// - Mainnet router (no adapter needed): PancakeSwap V2
///   0x10ED43C718714eb63d5aA57B78B54704E256024E, chain 56.
/// - Mainnet stablecoin: USDT 0x55d398326f99059fF775485246999027B3197955
///   (6 decimals) — pass as STABLE with stableDecimals 6.
/// - Testnet router (live, 153k+ txs): 0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3,
///   chain 97. There is no official USDT on BNB testnet; test with BUSD
///   0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7 (18 decimals) as the
///   stablecoin, or deploy a mock USDT.
/// - Chainlink BNB/USD mainnet exists (0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE)
///   but is an Aggregator, not an IPriceFeed — it cannot be pasted as the
///   vault's price feed without an adapter, and no per-token Chainlink
///   feed was confirmed for BNB testnet.
contract PancakeV2TwapFeed is IPriceFeed {
    address public immutable STABLE; // USDT (BNB mainnet) / BUSD (testnet)
    uint8 public immutable STABLE_DECIMALS;
    address public owner;

    struct PairInfo {
        address pair;
        uint8 tokenDecimals;
    }

    struct Observation {
        uint256 priceCumulative; // UQ112x112 cumulative at snapshot time
        uint256 timestamp;
        bool exists;
    }

    mapping(address => PairInfo) public pairs; // token -> pair + token decimals
    mapping(address => Observation) public observations; // token -> last snapshot

    event PairSet(address indexed token, address indexed pair, uint8 tokenDecimals);
    event ObservationUpdated(address indexed token, uint256 priceCumulative, uint256 timestamp);
    event OwnershipTransferred(address indexed newOwner);

    error PoolNotSet();
    error ObservationMissing();
    error ObservationTooShort();

    modifier onlyOwner() {
        require(msg.sender == owner, "PancakeV2TwapFeed: not owner");
        _;
    }

    constructor(address _stable, uint8 _stableDecimals, address _owner) {
        require(_stable != address(0), "stable required");
        require(_stableDecimals <= 18, "stable decimals > 18");
        require(_owner != address(0), "owner required");
        STABLE = _stable;
        STABLE_DECIMALS = _stableDecimals;
        owner = _owner;
    }

    /// @notice Register (or replace) the token/STABLE pair for a token.
    /// Reverts unless the pair's tokens are exactly {token, STABLE}.
    function setPair(address token, address pair, uint8 tokenDecimals) external onlyOwner {
        require(token != address(0) && pair != address(0), "zero address");
        require(tokenDecimals <= 18, "decimals > 18");
        address t0 = IPancakePairLike(pair).token0();
        address t1 = IPancakePairLike(pair).token1();
        require((t0 == token && t1 == STABLE) || (t0 == STABLE && t1 == token), "pair is not token/STABLE");
        pairs[token] = PairInfo({pair: pair, tokenDecimals: tokenDecimals});
        emit PairSet(token, pair, tokenDecimals);
    }

    function removePair(address token) external onlyOwner {
        delete pairs[token];
        delete observations[token];
        emit PairSet(token, address(0), 0);
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "owner required");
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }

    /// @notice Snapshot the pair's cumulative price for `token`. Anyone may
    /// call this; it only records a public on-chain value. The keeper
    /// should call it at least once per TWAP window.
    function update(address token) external {
        PairInfo memory info = pairs[token];
        if (info.pair == address(0)) revert PoolNotSet();
        uint256 cumulative = _currentCumulative(token, info.pair);
        observations[token] = Observation({
            priceCumulative: cumulative,
            timestamp: block.timestamp,
            exists: true
        });
        emit ObservationUpdated(token, cumulative, block.timestamp);
    }

    /// @notice Latest price: TWAP over the last 60 seconds (a short window,
    /// used for display/sanity only — the vault enforces triggers on twapPrice).
    function latestPrice(address token) external view override returns (uint256) {
        return _twap(token, 60);
    }

    /// @notice TWAP over `windowSeconds` for `token`, USD 18 decimals.
    /// The average covers (snapshot -> now), which must be at least
    /// `windowSeconds` long; see the contract notice for the keeper flow.
    function twapPrice(address token, uint256 windowSeconds) external view override returns (uint256) {
        return _twap(token, windowSeconds);
    }

    function _currentCumulative(address token, address pair) internal view returns (uint256) {
        IPancakePairLike p = IPancakePairLike(pair);
        return p.token0() == token ? p.price0CumulativeLast() : p.price1CumulativeLast();
    }

    function _twap(address token, uint256 windowSeconds) internal view returns (uint256) {
        PairInfo memory info = pairs[token];
        if (info.pair == address(0)) revert PoolNotSet();
        Observation memory obs = observations[token];
        if (!obs.exists) revert ObservationMissing();
        uint256 elapsed = block.timestamp - obs.timestamp;
        if (windowSeconds == 0 || elapsed < windowSeconds) revert ObservationTooShort();
        uint256 current = _currentCumulative(token, info.pair);
        uint256 delta;
        unchecked {
            // Cumulative prices wrap mod 2**256; the difference is correct
            // across a wrap, exactly as in Uniswap V2's oracle example.
            delta = current - obs.priceCumulative;
        }
        // mean UQ112x112 = delta / elapsed. priceRaw is STABLE smallest
        // units per 1 WHOLE token:
        //   priceRaw = delta * 10^tokenDecimals / (elapsed * 2^112)
        // One FullMath.mulDiv keeps this exact (512-bit intermediate).
        uint256 priceRaw = FullMath.mulDiv(delta, 10 ** info.tokenDecimals, elapsed * (1 << 112));
        // priceRaw is STABLE smallest units per whole token. Convert to
        // USD with 18 decimals: * 10^(18 - STABLE_DECIMALS).
        return priceRaw * (10 ** (18 - STABLE_DECIMALS));
    }
}
