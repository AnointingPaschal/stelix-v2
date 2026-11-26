// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IDexRouter.sol";
import "../interfaces/IERC20.sol";

/// @notice Minimal Uniswap V3 SwapRouter interface (exactInputSingle only).
interface ISwapRouterV3 {
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

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Minimal Uniswap V3 QuoterV2 interface (quotes only, no state change).
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @title StelixV3RouterAdapter — IDexRouter (V2-style) over Uniswap V3
/// @notice Lets StelixVault (which speaks the V2-style IDexRouter
/// interface: swapExactTokensForTokens with a [tokenIn, tokenOut] path)
/// swap on Arc testnet, where the only confirmed live DEX router is
/// Uniswap V3 SwapRouter 0xfA845604F52843a7b5cfA4030120c6238741F420
/// (verified source on testnet.arcscan.app). There is NO confirmed
/// V2-style router on Arc testnet — the canonical V2 router address has
/// no code there — so the vault cannot point at a V2 router directly.
///
/// Flow: the vault approves this adapter; the adapter pulls tokenIn from
/// the vault, approves the V3 router, and executes exactInputSingle with
/// the output paid straight to the vault's chosen recipient (`to`).
/// The adapter never holds user funds between calls and has no withdraw
/// function; a stuck approval is reset to 0 after every swap.
/// Fees are per-pair (owner-set, default 3000 = 0.3%). `getAmountsOut`
/// needs a QuoterV2: set it with setQuoter once a quoter address is
/// verified on the chain (the 0x3Ce95410... candidate on Arc testnet is
/// a live contract but its source is UNVERIFIED, so it is NOT set by
/// default — set it only after verification). Until then getAmountsOut
/// reverts; swaps still work.
contract StelixV3RouterAdapter is IDexRouter {
    address public immutable swapRouter;
    address public owner;
    address public quoter; // 0 = not set; getAmountsOut reverts until set

    uint24 public constant DEFAULT_FEE = 3000;
    mapping(address => mapping(address => uint24)) public pairFee; // tokenIn -> tokenOut -> fee

    event FeeSet(address indexed tokenIn, address indexed tokenOut, uint24 fee);
    event QuoterSet(address indexed quoter);
    event OwnershipTransferred(address indexed newOwner);

    error QuoterNotSet();
    error BadPath();

    modifier onlyOwner() {
        require(msg.sender == owner, "StelixV3RouterAdapter: not owner");
        _;
    }

    constructor(address _swapRouter, address _owner) {
        require(_swapRouter != address(0), "router required");
        require(_owner != address(0), "owner required");
        swapRouter = _swapRouter;
        owner = _owner;
    }

    function setFee(address tokenIn, address tokenOut, uint24 fee) external onlyOwner {
        require(tokenIn != address(0) && tokenOut != address(0), "zero address");
        require(fee <= 1_000_000, "fee too high");
        pairFee[tokenIn][tokenOut] = fee;
        emit FeeSet(tokenIn, tokenOut, fee);
    }

    function setQuoter(address _quoter) external onlyOwner {
        quoter = _quoter;
        emit QuoterSet(_quoter);
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "owner required");
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }

    function feeFor(address tokenIn, address tokenOut) public view returns (uint24) {
        uint24 fee = pairFee[tokenIn][tokenOut];
        return fee == 0 ? DEFAULT_FEE : fee;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        if (path.length != 2) revert BadPath();
        address tokenIn = path[0];
        address tokenOut = path[1];
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        require(IERC20(tokenIn).approve(swapRouter, amountIn), "approve failed");
        uint256 amountOut = ISwapRouterV3(swapRouter).exactInputSingle(
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: feeFor(tokenIn, tokenOut),
                recipient: to,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );
        require(IERC20(tokenIn).approve(swapRouter, 0), "approve reset failed");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        override
        returns (uint256[] memory amounts)
    {
        if (quoter == address(0)) revert QuoterNotSet();
        if (path.length != 2) revert BadPath();
        (uint256 amountOut, , , ) = IQuoterV2(quoter).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: path[0],
                tokenOut: path[1],
                amountIn: amountIn,
                fee: feeFor(path[0], path[1]),
                sqrtPriceLimitX96: 0
            })
        );
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }
}
