// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";
import "../interfaces/IPriceFeed.sol";

/// @notice Test-only price feed. The test sets spot + TWAP prices directly.
/// Production: replace with a DEX TWAP oracle / Chainlink feed adapter
/// implementing IPriceFeed (see docs in IPriceFeed.sol).
contract MockPriceFeed is IPriceFeed {
    mapping(address => uint256) public spot;
    mapping(address => uint256) public twap;

    function setPrice(address token, uint256 price) external {
        spot[token] = price;
        twap[token] = price;
    }

    function setSpotAndTwap(address token, uint256 _spot, uint256 _twap) external {
        spot[token] = _spot;
        twap[token] = _twap;
    }

    function latestPrice(address token) external view override returns (uint256) {
        return spot[token];
    }

    function twapPrice(address token, uint256 /*windowSeconds*/) external view override returns (uint256) {
        return twap[token];
    }
}
