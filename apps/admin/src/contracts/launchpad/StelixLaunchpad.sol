// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";

/// @title StelixLaunchpad — free fixed-price token sale on Arc testnet
/// @notice Gas only, NO Stelix launch fee. A seller creates a sale for an
/// existing ERC-20 (e.g. one made by StelixTokenFactory) at a fixed price
/// in the exit stablecoin (USDC on Arc testnet,
/// 0x3600000000000000000000000000000000000000, 6 decimals).
///
/// Price: `pricePerToken` = stablecoin smallest units per ONE WHOLE token.
/// Example: token with 18 decimals at $0.10 -> pricePerToken = 100_000
/// (0.10 USDC = 100,000 micro-USDC). A 10 USDC contribution buys
/// 10_000_000 * 10^18 / 100_000 = 100 tokens.
///
/// Flow: createLaunch (seller deposits the tokens for sale up front) ->
/// contribute during [startTime, endTime] -> finalize after endTime ->
///   - raised >= softCap (SUCCESS): contributors claim tokens, the
///     seller withdraws raised funds minus the liquidity reserve.
///   - raised < softCap (FAILED): contributors refund in full.
/// Liquidity lock: `liquidityLockBps` (max 50%) of the raised funds plus
/// the matching tokens at the sale price are earmarked in the contract at
/// finalize. They can ONLY be released to a liquidity-manager contract
/// set by the owner (setLiquidityManager) — until a DEX route for launch
/// liquidity is confirmed and that manager is set and audited, the
/// reserves stay locked in this contract. The step is therefore
/// 'pending Arc DEX confirmation', never silently skipped and never
/// paid out to the seller. See README section "Launchpad liquidity".
///
/// Safety: reentrancy-guarded fund-moving functions, checks-effects-
/// interactions, no fee, no admin withdrawal of user funds (the seller
/// can only withdraw THEIR OWN raised funds after a successful sale;
/// contributors can only claim/refund their own amounts).
contract StelixLaunchpad {
    uint256 public constant MAX_LIQUIDITY_BPS = 5000; // 50%
    uint256 public constant BPS_DENOMINATOR = 10000;

    address public immutable stablecoin; // USDC on Arc testnet
    address public owner;
    address public liquidityManager; // 0 until a DEX liquidity manager is set

    enum SaleStatus {
        Active,
        Success,
        Failed
    }

    struct Sale {
        address seller;
        address token;
        uint8 tokenDecimals;
        uint256 pricePerToken; // stablecoin smallest units per 1 whole token
        uint256 softCap; // stablecoin smallest units
        uint256 hardCap; // stablecoin smallest units
        uint256 startTime;
        uint256 endTime;
        uint16 liquidityLockBps;
        uint256 tokensForSale; // deposited at creation
        uint256 raised; // stablecoin smallest units
        uint256 tokensSold; // token smallest units
        uint256 contributors;
        uint256 liquidityReserveStable; // earmarked at finalize (success)
        uint256 liquidityReserveTokens; // earmarked at finalize (success)
        bool liquidityReleased;
        bool raisedWithdrawn;
        SaleStatus status;
        bool finalized;
    }

    uint256 public nextSaleId;
    mapping(uint256 => Sale) public sales;
    mapping(uint256 => mapping(address => uint256)) public contributions; // saleId -> user -> stablecoin amount
    mapping(uint256 => mapping(address => bool)) public claimed; // saleId -> user -> tokens claimed
    mapping(uint256 => mapping(address => bool)) public refunded; // saleId -> user -> refunded

    event SaleCreated(
        uint256 indexed saleId,
        address indexed seller,
        address indexed token,
        uint256 pricePerToken,
        uint256 softCap,
        uint256 hardCap,
        uint256 startTime,
        uint256 endTime,
        uint16 liquidityLockBps,
        uint256 tokensForSale
    );
    event Contributed(uint256 indexed saleId, address indexed user, uint256 amount, uint256 raised);
    event Finalized(uint256 indexed saleId, bool success, uint256 raised);
    event Claimed(uint256 indexed saleId, address indexed user, uint256 tokenAmount);
    event Refunded(uint256 indexed saleId, address indexed user, uint256 amount);
    event RaisedWithdrawn(uint256 indexed saleId, address indexed seller, uint256 amount);
    event LiquidityManagerSet(address indexed manager);
    event LiquidityReleased(uint256 indexed saleId, address indexed manager, uint256 stableAmount, uint256 tokenAmount);
    event OwnershipTransferred(address indexed newOwner);

    error InvalidParams();
    error SaleNotActive();
    error SaleNotEnded();
    error SaleNotFinalized();
    error NotSeller();
    error NothingToClaim();
    error AlreadyClaimed();
    error LiquidityNotReady();

    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "ReentrancyGuard: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "StelixLaunchpad: not owner");
        _;
    }

    constructor(address _stablecoin, address _owner) {
        require(_stablecoin != address(0), "stablecoin required");
        require(_owner != address(0), "owner required");
        stablecoin = _stablecoin;
        owner = _owner;
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "owner required");
        owner = _owner;
        emit OwnershipTransferred(_owner);
    }

    /// @notice Set the liquidity-manager contract that may receive the
    /// earmarked liquidity reserves. Only the owner, only to a non-zero
    /// address, and only after the DEX route for launch liquidity is
    /// confirmed. Until set, reserves stay locked (pending, not lost).
    function setLiquidityManager(address _manager) external onlyOwner {
        require(_manager != address(0), "manager required");
        liquidityManager = _manager;
        emit LiquidityManagerSet(_manager);
    }

    /// @notice Create a sale. The seller must approve `tokensForSale` to
    /// this contract first; the tokens are pulled in at creation so a
    /// sale can never promise tokens it does not hold.
    function createLaunch(
        address token,
        uint256 pricePerToken,
        uint256 softCap,
        uint256 hardCap,
        uint256 startTime,
        uint256 endTime,
        uint16 liquidityLockBps,
        uint256 tokensForSale
    ) external nonReentrant returns (uint256 saleId) {
        if (token == address(0)) revert InvalidParams();
        if (pricePerToken == 0) revert InvalidParams();
        if (softCap == 0 || hardCap < softCap) revert InvalidParams();
        if (startTime >= endTime || endTime <= block.timestamp) revert InvalidParams();
        if (liquidityLockBps > MAX_LIQUIDITY_BPS) revert InvalidParams();
        if (tokensForSale == 0) revert InvalidParams();
        uint8 tokenDecimals = _tokenDecimals(token);
        // The deposited tokens must cover the hard cap at the sale price,
        // otherwise the hard cap could never be reached honestly.
        uint256 tokensNeededForHardCap = (hardCap * (10 ** tokenDecimals)) / pricePerToken;
        if (tokensForSale < tokensNeededForHardCap) revert InvalidParams();

        saleId = nextSaleId++;
        Sale storage s = sales[saleId];
        s.seller = msg.sender;
        s.token = token;
        s.tokenDecimals = tokenDecimals;
        s.pricePerToken = pricePerToken;
        s.softCap = softCap;
        s.hardCap = hardCap;
        s.startTime = startTime;
        s.endTime = endTime;
        s.liquidityLockBps = liquidityLockBps;
        s.tokensForSale = tokensForSale;
        s.status = SaleStatus.Active;

        require(
            IERC20(token).transferFrom(msg.sender, address(this), tokensForSale),
            "StelixLaunchpad: token deposit failed"
        );
        emit SaleCreated(
            saleId, msg.sender, token, pricePerToken, softCap, hardCap, startTime, endTime, liquidityLockBps, tokensForSale
        );
    }

    /// @notice Contribute stablecoin during the sale window.
    function contribute(uint256 saleId, uint256 amount) external nonReentrant {
        Sale storage s = sales[saleId];
        if (s.seller == address(0)) revert InvalidParams();
        if (s.status != SaleStatus.Active) revert SaleNotActive();
        if (block.timestamp < s.startTime || block.timestamp > s.endTime) revert SaleNotActive();
        if (amount == 0) revert InvalidParams();
        if (s.raised + amount > s.hardCap) revert InvalidParams();
        uint256 tokenAmount = (amount * (10 ** s.tokenDecimals)) / s.pricePerToken;
        if (s.tokensSold + tokenAmount > s.tokensForSale) revert InvalidParams();

        if (contributions[saleId][msg.sender] == 0) s.contributors += 1;
        contributions[saleId][msg.sender] += amount;
        s.raised += amount;
        s.tokensSold += tokenAmount;

        require(
            IERC20(stablecoin).transferFrom(msg.sender, address(this), amount),
            "StelixLaunchpad: contribution failed"
        );
        emit Contributed(saleId, msg.sender, amount, s.raised);
    }

    /// @notice Progress: raised, caps, percent (bps), contributors, tokens sold.
    function progress(uint256 saleId)
        external
        view
        returns (uint256 raised, uint256 softCap, uint256 hardCap, uint256 percentBps, uint256 contributors, uint256 tokensSold)
    {
        Sale storage s = sales[saleId];
        raised = s.raised;
        softCap = s.softCap;
        hardCap = s.hardCap;
        percentBps = s.hardCap == 0 ? 0 : (s.raised * BPS_DENOMINATOR) / s.hardCap;
        contributors = s.contributors;
        tokensSold = s.tokensSold;
    }

    /// @notice Tokens owed to a contributor at the sale price.
    function tokensOwed(uint256 saleId, address user) public view returns (uint256) {
        Sale storage s = sales[saleId];
        return (contributions[saleId][user] * (10 ** s.tokenDecimals)) / s.pricePerToken;
    }

    /// @notice Finalize after endTime. Anyone can call. Sets Success when
    /// the soft cap was met, Failed otherwise, and earmarks the liquidity
    /// reserve on success.
    function finalize(uint256 saleId) external {
        Sale storage s = sales[saleId];
        if (s.seller == address(0)) revert InvalidParams();
        if (s.finalized) revert InvalidParams();
        if (block.timestamp <= s.endTime) revert SaleNotEnded();
        s.finalized = true;
        if (s.raised >= s.softCap) {
            s.status = SaleStatus.Success;
            s.liquidityReserveStable = (s.raised * s.liquidityLockBps) / BPS_DENOMINATOR;
            s.liquidityReserveTokens = (s.liquidityReserveStable * (10 ** s.tokenDecimals)) / s.pricePerToken;
        } else {
            s.status = SaleStatus.Failed;
        }
        emit Finalized(saleId, s.status == SaleStatus.Success, s.raised);
    }

    /// @notice Claim bought tokens after a successful sale.
    function claim(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        if (!s.finalized || s.status != SaleStatus.Success) revert SaleNotFinalized();
        if (claimed[saleId][msg.sender]) revert AlreadyClaimed();
        uint256 amount = tokensOwed(saleId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[saleId][msg.sender] = true;
        require(IERC20(s.token).transfer(msg.sender, amount), "StelixLaunchpad: claim failed");
        emit Claimed(saleId, msg.sender, amount);
    }

    /// @notice Refund in full after a failed sale.
    function refund(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        if (!s.finalized || s.status != SaleStatus.Failed) revert SaleNotFinalized();
        if (refunded[saleId][msg.sender]) revert AlreadyClaimed();
        uint256 amount = contributions[saleId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        refunded[saleId][msg.sender] = true;
        require(IERC20(stablecoin).transfer(msg.sender, amount), "StelixLaunchpad: refund failed");
        emit Refunded(saleId, msg.sender, amount);
    }

    /// @notice Seller withdraws raised funds minus the liquidity reserve,
    /// after a successful sale. Unsold deposited tokens stay in the
    /// contract with the liquidity reserve (they are part of it).
    function withdrawRaised(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        if (msg.sender != s.seller) revert NotSeller();
        if (!s.finalized || s.status != SaleStatus.Success) revert SaleNotFinalized();
        if (s.raisedWithdrawn) revert AlreadyClaimed();
        uint256 amount = s.raised - s.liquidityReserveStable;
        if (amount == 0) revert NothingToClaim();
        // Prevent double-withdraw; `raised` stays intact for progress().
        s.raisedWithdrawn = true;
        require(IERC20(stablecoin).transfer(s.seller, amount), "StelixLaunchpad: withdraw failed");
        emit RaisedWithdrawn(saleId, s.seller, amount);
    }

    /// @notice Release earmarked liquidity reserves to the set manager.
    /// Reverts until a liquidity manager is set (DEX route confirmed).
    function releaseLiquidity(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        if (!s.finalized || s.status != SaleStatus.Success) revert SaleNotFinalized();
        if (s.liquidityReleased) revert AlreadyClaimed();
        if (liquidityManager == address(0)) revert LiquidityNotReady();
        s.liquidityReleased = true;
        if (s.liquidityReserveStable > 0) {
            require(
                IERC20(stablecoin).transfer(liquidityManager, s.liquidityReserveStable),
                "StelixLaunchpad: stable release failed"
            );
        }
        if (s.liquidityReserveTokens > 0) {
            require(
                IERC20(s.token).transfer(liquidityManager, s.liquidityReserveTokens),
                "StelixLaunchpad: token release failed"
            );
        }
        emit LiquidityReleased(saleId, liquidityManager, s.liquidityReserveStable, s.liquidityReserveTokens);
    }

    /// @notice Leftover deposited tokens (unsold, not earmarked) return to
    /// the seller after a successful sale once liquidity is released, or
    /// after a failed sale. Keeps seller funds from stranding.
    function withdrawUnsoldTokens(uint256 saleId) external nonReentrant {
        Sale storage s = sales[saleId];
        if (msg.sender != s.seller) revert NotSeller();
        if (!s.finalized) revert SaleNotFinalized();
        uint256 leftover;
        if (s.status == SaleStatus.Failed) {
            leftover = s.tokensForSale;
        } else {
            // Success: unsold = deposited - sold - liquidity reserve tokens.
            // Liquidity must be released first so the reserve is not
            // double-counted as leftover.
            if (!s.liquidityReleased && s.liquidityReserveTokens > 0) revert LiquidityNotReady();
            leftover = s.tokensForSale - s.tokensSold - s.liquidityReserveTokens;
        }
        if (leftover == 0) revert NothingToClaim();
        // Prevent double-withdraw.
        s.tokensForSale = s.tokensSold + s.liquidityReserveTokens;
        require(IERC20(s.token).transfer(s.seller, leftover), "StelixLaunchpad: withdraw failed");
    }

    function getSale(uint256 saleId) external view returns (Sale memory) {
        require(sales[saleId].seller != address(0), "StelixLaunchpad: sale does not exist");
        return sales[saleId];
    }

    /// @dev Reads decimals() from the token; reverts for non-ERC20 addresses.
    function _tokenDecimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok && data.length == 32, "StelixLaunchpad: bad token");
        return abi.decode(data, (uint8));
    }
}
