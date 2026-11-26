// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only Uniswap V3 pool: fixed tokens + settable TWAP observations.
contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    int56 public cumulative0;
    int56 public cumulative1;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    /// @notice Set the two tick cumulatives observe() will return.
    function setCumulatives(int56 _c0, int56 _c1) external {
        cumulative0 = _c0;
        cumulative1 = _c1;
    }

    /// @notice Set a constant mean tick over `windowSeconds`.
    function setMeanTick(int24 meanTick, uint32 windowSeconds) external {
        cumulative0 = 0;
        cumulative1 = int56(int256(meanTick) * int256(uint256(windowSeconds)));
    }

    function observe(uint32[] calldata /*secondsAgos*/)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = cumulative0;
        tickCumulatives[1] = cumulative1;
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
    }
}
