// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";

/// @notice Test-only Uniswap V3 SwapRouter: fixed-rate exactInputSingle.
/// `rate` = stablecoin-out per 1 token-in, 18 decimals (2e18 = 1 token -> 2 stable).
contract MockV3Router {
    mapping(address => uint256) public rate;
    bool public failing;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function setRate(address tokenIn, uint256 _rate) external {
        rate[tokenIn] = _rate;
    }

    function setFailing(bool _failing) external {
        failing = _failing;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        require(!failing, "MockV3Router: swap failed");
        amountOut = (p.amountIn * rate[p.tokenIn]) / 1e18;
        require(amountOut >= p.amountOutMinimum, "MockV3Router: insufficient output");
        require(IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn), "pull failed");
        require(IERC20(p.tokenOut).transfer(p.recipient, amountOut), "pay failed");
    }
}

/// @notice Test-only QuoterV2: fixed-rate quoteExactInputSingle.
contract MockQuoterV2 {
    mapping(address => uint256) public rate;

    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function setRate(address tokenIn, uint256 _rate) external {
        rate[tokenIn] = _rate;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata p)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        amountOut = (p.amountIn * rate[p.tokenIn]) / 1e18;
        sqrtPriceX96After = 0;
        initializedTicksCrossed = 0;
        gasEstimate = 0;
    }
}
