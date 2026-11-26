// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IPriceFeed.sol";
import "../vendor/TickMath.sol";
import "../vendor/FullMath.sol";

/// @notice Minimal Uniswap V3 pool interface — only what the TWAP feed needs.
interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title UniswapV3TwapFeed — IPriceFeed from a Uniswap V3 (Bulba) pool TWAP
/// @notice Production price feed for StelixVault on Arc testnet.
///
/// WHY THIS EXISTS: Arc testnet has NO Uniswap V2-style router and NO
/// confirmed Chainlink feed address for any token (the Eco-docs ETH/USD
/// feed 0x50FCDD99... has no code on testnet; Chainlink Data Feeds were
/// only announced for Arc on 2026-11-23 and no per-token testnet feed
/// address could be confirmed). What DOES exist on testnet, verified on
/// testnet.arcscan.app, is Uniswap V3 (Bulba): factory
/// 0xcD072e113277d1f5460Bf69568f649b26BD01EF9, SwapRouter
/// 0xfA845604F52843a7b5cfA4030120c6238741F420, NonfungiblePositionManager
/// 0xBe9ec79854e459F38E0B868A0c3429AAbf6784b2.
///
/// This adapter reads the pool's TWAP via `observe()` and converts the
/// mean tick to a USD price with 18 decimals, using the vendored Uniswap
/// TickMath + FullMath (exact arithmetic, no oracle trusted beyond the
/// pool itself). The pool MUST be token/USDC (USDC
/// 0x3600000000000000000000000000000000000000, 6 decimals).
///
/// LIMITS (honest): a TWAP is only as good as the pool's liquidity. A
/// thin pool can be manipulated over 30 minutes at real cost, but not by
/// a one-minute wick — which is exactly the guarantee StelixVault needs.
/// Before pointing the vault at a pool for real value: check the pool
/// exists, has real liquidity, and its observations cover the window.
/// `twapPrice` reverts when the pool has no observations for the
/// requested window instead of returning a stale or spot price.
contract UniswapV3TwapFeed is IPriceFeed {
    address public immutable USDC; // Arc testnet USDC, 6 decimals
    address public owner;

    struct PoolInfo {
        address pool;
        uint8 tokenDecimals;
    }

    mapping(address => PoolInfo) public pools; // token -> pool + token decimals

    event PoolSet(address indexed token, address indexed pool, uint8 tokenDecimals);
    event OwnershipTransferred(address indexed newOwner);

    error PoolNotSet();
    error ObservationTooShort();

    modifier onlyOwner() {
        require(msg.sender == owner, "UniswapV3TwapFeed: not owner");
        _;
    }

    constructor(address _usdc, address _owner) {
        require(_usdc != address(0), "usdc required");
        require(_owner != address(0), "owner required");
        USDC = _usdc;
        owner = _owner;
    }

    /// @notice Register (or replace) the token/USDC pool for a token.
    /// Reverts unless the pool's tokens are exactly {token, USDC}.
    function setPool(address token, address pool, uint8 tokenDecimals) external onlyOwner {
        require(token != address(0) && pool != address(0), "zero address");
        require(tokenDecimals <= 18, "decimals > 18");
        address t0 = IUniswapV3PoolLike(pool).token0();
        address t1 = IUniswapV3PoolLike(pool).token1();
        require((t0 == token && t1 == USDC) || (t0 == USDC && t1 == token), "pool is not token/USDC");
        pools[token] = PoolInfo({pool: pool, tokenDecimals: tokenDecimals});
        emit PoolSet(token, pool, tokenDecimals);
    }

    function removePool(address token) external onlyOwner {
        delete pools[token];
        emit PoolSet(token, address(0), 0);
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "owner required");
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }

    /// @notice Latest price: TWAP over the last 60 seconds (a short window,
    /// used for display/sanity only — the vault enforces triggers on twapPrice).
    function latestPrice(address token) external view override returns (uint256) {
        return _twap(token, 60);
    }

    /// @notice TWAP over `windowSeconds` for `token`, USD 18 decimals.
    function twapPrice(address token, uint256 windowSeconds) external view override returns (uint256) {
        return _twap(token, windowSeconds);
    }

    function _twap(address token, uint256 windowSeconds) internal view returns (uint256) {
        PoolInfo memory info = pools[token];
        if (info.pool == address(0)) revert PoolNotSet();
        if (windowSeconds == 0 || windowSeconds > type(uint32).max) revert ObservationTooShort();
        IUniswapV3PoolLike pool = IUniswapV3PoolLike(info.pool);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = uint32(windowSeconds);
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);
        // Mean tick over the window. Solidity truncates signed division
        // toward zero; a 1-tick error is far below price noise.
        int56 tickCumulativeDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 meanTick = int24(tickCumulativeDelta / int56(int256(windowSeconds)));
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(meanTick);

        // S = sqrt(token1/token0) in raw units = sqrtPriceX96 / 2^96.
        // priceRaw = USDC smallest units (6 dec) per 1 WHOLE token.
        //   token == token0: priceRaw = S^2 * 10^tokenDecimals
        //     = mulDiv(sqrt, sqrt * 10^D, 2^192)   (exact, 512-bit)
        //   token == token1: priceRaw = 10^D / S^2
        //     = mulDiv(mulDiv(2^192, 10^D, sqrt), 1, sqrt)
        //     (two steps so no intermediate exceeds 256 bits)
        uint256 scale = 10 ** info.tokenDecimals;
        uint256 priceRaw;
        if (pool.token0() == token) {
            priceRaw = FullMath.mulDiv(sqrtPriceX96, uint256(sqrtPriceX96) * scale, 1 << 192);
        } else {
            uint256 y = FullMath.mulDiv(1 << 192, scale, sqrtPriceX96);
            priceRaw = FullMath.mulDiv(y, 1, sqrtPriceX96);
        }
        // priceRaw is USDC smallest units (6 dec) per whole token.
        // Convert to USD with 18 decimals: * 10^12.
        return priceRaw * 1e12;
    }
}
