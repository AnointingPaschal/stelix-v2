// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";

/// @notice Test-only DEX router. Swaps at a configurable fixed rate:
/// `rate` = stablecoin-out per 1 locked token, 18 decimals
/// (e.g. rate 2e18 means 1 token -> 2 stablecoin).
/// It holds a pre-funded stablecoin balance (minted in tests) and reverts
/// if the output would be below amountOutMin, mirroring real slippage
/// enforcement. It can also be put into "failing" mode to test the
/// vault's fail-safe (lock stays locked, no partial sale).
contract MockRouter {
    mapping(address => uint256) public rate; // tokenIn -> stableOut per token, 1e18
    bool public failing;

    function setRate(address tokenIn, uint256 _rate) external {
        rate[tokenIn] = _rate;
    }

    function setFailing(bool _failing) external {
        failing = _failing;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = (amountIn * rate[path[0]]) / 1e18;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        require(!failing, "MockRouter: swap failed");
        require(path.length == 2, "MockRouter: bad path");
        uint256 amountOut = (amountIn * rate[path[0]]) / 1e18;
        require(amountOut >= amountOutMin, "MockRouter: insufficient output");
        require(IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        require(IERC20(path[1]).transfer(to, amountOut), "pay failed");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }
}
