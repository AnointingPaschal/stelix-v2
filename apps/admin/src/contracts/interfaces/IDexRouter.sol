// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal DEX router interface (Uniswap V2 / PancakeSwap style).
/// StelixVault only ever calls swapExactTokensForTokens with a path of
/// [lockedToken -> lock stablecoin] and pays the output to the lock owner.
interface IDexRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Quote only. Declared non-view because a Uniswap V3 quoter
    /// (QuoterV2.quoteExactInputSingle) is not a view call — the
    /// StelixV3RouterAdapter needs to call it. V2-style routers may still
    /// implement this as view. The vault never calls this on-chain.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        returns (uint256[] memory amounts);
}
