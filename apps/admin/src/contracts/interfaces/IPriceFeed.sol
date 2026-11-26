// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Price-feed interface used by StelixVault for Bull Lock triggers.
/// Prices are USD-denominated with 18 decimals (1 USD == 1e18).
/// Production feeds: a DEX TWAP oracle (30-min window per the pitch, Part B)
/// and/or Chainlink where a feed exists for the token. The vault reads the
/// TWAP, never a single spot tick, so a one-minute wick cannot fire a sell.
/// The keeper supplies NO price — it only calls executeTrigger(); the
/// contract re-checks the oracle itself, so a compromised keeper cannot
/// force a sale at a fake price.
interface IPriceFeed {
    /// @notice Latest spot price (18 decimals). Used for display / sanity only.
    function latestPrice(address token) external view returns (uint256);

    /// @notice Time-weighted average price over `windowSeconds` (18 decimals).
    /// This is the price executeTrigger() enforces targets against.
    function twapPrice(address token, uint256 windowSeconds) external view returns (uint256);
}
