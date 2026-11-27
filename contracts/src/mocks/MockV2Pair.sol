// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only PancakeSwap V2 pair: fixed tokens + settable cumulative
/// prices (UQ112x112), mirroring MockV3Pool for the V3 feed.
contract MockV2Pair {
    address public immutable token0;
    address public immutable token1;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    /// @notice Set the two cumulative prices the feed will read.
    function setCumulatives(uint256 _c0, uint256 _c1) external {
        price0CumulativeLast = _c0;
        price1CumulativeLast = _c1;
    }

    /// @notice Set a constant price over `windowSeconds`: cumulative =
    /// priceUQ112x112 * windowSeconds, for the orientation where `token`
    /// is token0 (c0) or token1 (c1). The other side is left at 0.
    function setConstantPrice(address token, uint256 priceUQ112x112, uint256 windowSeconds) external {
        uint256 cumulative = priceUQ112x112 * windowSeconds;
        if (token == token0) {
            price0CumulativeLast = cumulative;
        } else {
            price1CumulativeLast = cumulative;
        }
    }
}
