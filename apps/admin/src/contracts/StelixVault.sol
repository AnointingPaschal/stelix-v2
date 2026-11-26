// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * StelixVault — Stelix 2.0 Bull Lock (FRESH contract, no V1/V2/V3 legacy)
 * =======================================================================
 * Spec: ~/workspace/your_files/stelix-2-0-pitch/stelix-2-0-pitch.pdf
 *       Part B (Bull Lock) and Part F (StelixVault).
 *
 * Non-custodial multichain vault. A user locks ERC-20 tokens until the
 * EARLIER of a chosen date or a chosen price target. On a price target the
 * due ladder stage is auto-sold to the lock's stablecoin (USDT on most
 * chains; USDC on Arc where the registry says so — the stablecoin is a
 * per-lock setting, never an assumption) and paid to the lock owner.
 *
 * Security properties (by design, not by policy):
 *  - ReentrancyGuard on every fund-moving function; checks-effects-
 *    interactions throughout; no external call before state is updated.
 *  - NO admin withdrawal function. NO emergency drain. The owner/keeper
 *    can never move a user's locked funds to themselves.
 *  - Keeper power is narrow: executeTrigger() can only swap a DUE stage
 *    to the lock's stablecoin and pay the lock owner, or do nothing.
 *  - Non-upgradeable by design: what a user locks under governs that
 *    lock forever. Improvements ship as a new deployment for new locks.
 *  - Penalty is only ever charged on an early break with no trigger met.
 *    Price-target and maturity exits are always penalty-free.
 *  - TWAP guard: triggers are checked against the 30-minute TWAP from
 *    the price feed, never a spot tick, so a one-minute wick cannot fire
 *    a sale. Slippage + minimum-receive are enforced on every swap; a
 *    failed swap leaves the lock untouched (fail-safe, keeper retries).
 *
 * Prices are USD with 18 decimals (1 USD == 1e18). Token amounts are in
 * the token's own decimals; stablecoin amounts in the stablecoin's.
 * Basis points: 10000 == 100%.
 */

import "./interfaces/IERC20.sol";
import "./interfaces/IDexRouter.sol";
import "./interfaces/IPriceFeed.sol";

contract StelixVault {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum BreakMode {
        Immutable, // 0: no early break at all
        Penalty, // 1: break after 24h cooling-off, stored penaltyBps applies
        Guardian // 2: Phase 2 — accountability-partner approval + 48h delay (NOT enabled yet)
    }

    enum LockStatus {
        Active,
        PartiallySold,
        Completed, // every stage sold via target / trailing stop
        Matured, // claimed after unlockTime
        Broken // early break executed
    }

    struct LadderStage {
        uint256 targetPrice; // USD, 18 decimals; stage sells when TWAP >= this
        uint16 sellBps; // share of the ORIGINAL locked amount, 10000 = 100%
        bool sold;
    }

    struct Lock {
        address owner;
        address token;
        uint256 amountRemaining;
        uint256 amountTotal; // original locked amount (ladder %s are of this)
        uint256 entryPrice; // USD, 18 decimals, recorded at lock time
        uint256 unlockTime;
        LadderStage[] ladderStages;
        uint16 trailingStopBps; // 0 = off; e.g. 1000 = 10% fall from peak
        uint256 peakPrice; // highest TWAP seen since a stage was first sold
        BreakMode breakMode;
        uint16 penaltyBps; // 500-1000 (5-10%) when breakMode == Penalty, else 0
        bool autoSell; // false = on target, unlock stage to wallet unsold
        address stablecoin; // per-lock exit stablecoin (USDT / USDC per chain registry)
        address router; // DEX router snapshot at lock time
        uint16 slippageBps; // e.g. 150 = 1.5% default
        uint256 minReceivePerStage; // minimum stablecoin for a stage swap; 0 = no floor
        LockStatus status;
        // --- snapshots / bookkeeping (not in the pitch's core list) ---
        uint256 feeBps; // auto-sell fee snapshot at creation (0 at launch)
        address penaltyRecipient; // where a break penalty goes (treasury / burn addr)
        uint256 breakRequestedAt; // 0 = no break requested
    }

    struct CreateLockParams {
        address token;
        uint256 amount;
        uint256 unlockTime;
        uint256 entryPrice;
        LadderStage[] ladderStages;
        uint16 trailingStopBps;
        BreakMode breakMode;
        uint16 penaltyBps;
        bool autoSell;
        address stablecoin;
        uint16 slippageBps;
        uint256 minReceivePerStage;
    }

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------
    uint256 public constant TWAP_WINDOW = 30 minutes; // pitch Part B
    uint256 public constant PENALTY_COOLING_OFF = 24 hours;
    uint256 public constant GUARDIAN_COOLING_OFF = 48 hours;
    uint256 public constant MAX_SLIPPAGE_BPS = 5000; // 50% hard cap
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    address public owner;
    address public keeper;
    address public router; // default DEX router for new locks
    address public priceFeed; // IPriceFeed (TWAP / Chainlink adapter)
    address public penaltyRecipient; // default penalty destination for new locks
    address public feeRecipient;
    uint16 public autoSellFeeBps; // 0 at launch; only affects locks created after a change
    bool public newLocksPaused;

    uint256 public nextLockId;
    mapping(uint256 => Lock) private locks;
    mapping(address => uint256[]) private userLocks;

    // Minimal reentrancy guard (no external deps by design).
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "ReentrancyGuard: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "StelixVault: caller is not the owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "StelixVault: caller is not the keeper");
        _;
    }

    // ------------------------------------------------------------------
    // Events (pitch Part F)
    // ------------------------------------------------------------------
    event Locked(
        uint256 indexed lockId,
        address indexed owner,
        address indexed token,
        uint256 amount,
        uint256 unlockTime,
        uint256 entryPrice
    );
    event TargetTriggered(uint256 indexed lockId, uint256 indexed stageIndex, uint256 targetPrice, uint256 price);
    event AutoSold(
        uint256 indexed lockId,
        uint256 indexed stageIndex,
        uint256 amountIn,
        uint256 stableReceived,
        address stablecoin
    );
    event TrailingStopTriggered(uint256 indexed lockId, uint256 peakPrice, uint256 price);
    event PeakUpdated(uint256 indexed lockId, uint256 peakPrice, uint256 price);
    event Matured(uint256 indexed lockId, address indexed owner, uint256 amount);
    event Unlocked(uint256 indexed lockId, address indexed owner, uint256 amount, address token);
    event BreakRequested(uint256 indexed lockId, address indexed owner, uint256 executeAfter);
    event Broken(uint256 indexed lockId, address indexed owner, uint256 returned, uint256 penalty);
    event KeeperSet(address indexed keeper);
    event RouterSet(address indexed router);
    event PriceFeedSet(address indexed priceFeed);
    event NewLocksPaused(bool paused);
    event AutoSellFeeSet(uint16 feeBps, address feeRecipient);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error ImmutableLock();
    error GuardianBreakNotEnabled();
    error TriggerNotDue();
    error NotMatured();
    error BreakNotRequested();
    error CoolingOffNotElapsed();
    error MinReceiveNotMet();
    error InvalidParams();

    // ------------------------------------------------------------------
    // Constructor — no secrets, no keys; all addresses are public config.
    // ------------------------------------------------------------------
    constructor(
        address _owner,
        address _keeper,
        address _router,
        address _priceFeed,
        address _penaltyRecipient,
        address _feeRecipient,
        uint16 _autoSellFeeBps
    ) {
        require(_owner != address(0), "owner required");
        require(_router != address(0), "router required");
        require(_priceFeed != address(0), "price feed required");
        require(_autoSellFeeBps <= 1000, "fee too high"); // <= 10%
        owner = _owner;
        keeper = _keeper;
        router = _router;
        priceFeed = _priceFeed;
        penaltyRecipient = _penaltyRecipient;
        feeRecipient = _feeRecipient;
        autoSellFeeBps = _autoSellFeeBps;
    }

    // ------------------------------------------------------------------
    // createLock — user locks tokens (after ERC-20 approval).
    // ------------------------------------------------------------------
    function createLock(CreateLockParams calldata p) external nonReentrant returns (uint256 lockId) {
        if (newLocksPaused) revert InvalidParams();
        if (p.token == address(0) || p.stablecoin == address(0)) revert InvalidParams();
        if (p.amount == 0) revert InvalidParams();
        if (p.unlockTime <= block.timestamp) revert InvalidParams();
        if (p.slippageBps > MAX_SLIPPAGE_BPS) revert InvalidParams();
        if (p.trailingStopBps > 5000) revert InvalidParams();
        if (p.breakMode == BreakMode.Penalty) {
            if (p.penaltyBps < 500 || p.penaltyBps > 1000) revert InvalidParams(); // 5-10%
        } else if (p.penaltyBps != 0) {
            revert InvalidParams();
        }

        uint256 totalSellBps;
        uint256 prevTarget;
        for (uint256 i; i < p.ladderStages.length; i++) {
            if (p.ladderStages[i].sellBps == 0) revert InvalidParams();
            if (p.ladderStages[i].targetPrice == 0) revert InvalidParams();
            if (p.ladderStages[i].targetPrice <= prevTarget) revert InvalidParams(); // ascending
            totalSellBps += p.ladderStages[i].sellBps;
            prevTarget = p.ladderStages[i].targetPrice;
        }
        if (totalSellBps > BPS_DENOMINATOR) revert InvalidParams();
        if (p.ladderStages.length > 0) {
            if (p.entryPrice == 0) revert InvalidParams();
            if (p.ladderStages[0].targetPrice <= p.entryPrice) revert InvalidParams();
        }
        // Ladder must total 100% unless the remainder is meant to be
        // claimed at maturity — allowed: unsold remainder unlocks on date.
        // (Pitch example: 25%+25%+25% then remainder at the date.)

        lockId = nextLockId++;
        Lock storage l = locks[lockId];
        l.owner = msg.sender;
        l.token = p.token;
        l.amountRemaining = p.amount;
        l.amountTotal = p.amount;
        l.entryPrice = p.entryPrice;
        l.unlockTime = p.unlockTime;
        l.trailingStopBps = p.trailingStopBps;
        l.peakPrice = p.entryPrice;
        l.breakMode = p.breakMode;
        l.penaltyBps = p.penaltyBps;
        l.autoSell = p.autoSell;
        l.stablecoin = p.stablecoin;
        l.router = router;
        l.slippageBps = p.slippageBps;
        l.minReceivePerStage = p.minReceivePerStage;
        l.status = LockStatus.Active;
        l.feeBps = autoSellFeeBps;
        l.penaltyRecipient = penaltyRecipient;
        for (uint256 i; i < p.ladderStages.length; i++) {
            l.ladderStages.push(p.ladderStages[i]);
        }

        userLocks[msg.sender].push(lockId);

        // Effects before interaction: state is fully recorded above.
        require(
            IERC20(p.token).transferFrom(msg.sender, address(this), p.amount),
            "StelixVault: token pull failed"
        );
        emit Locked(lockId, msg.sender, p.token, p.amount, p.unlockTime, p.entryPrice);
    }

    // ------------------------------------------------------------------
    // claimMatured — lock owner, after unlockTime. No keeper needed.
    // Penalty-free by construction: this path never charges a penalty.
    // ------------------------------------------------------------------
    function claimMatured(uint256 lockId) external nonReentrant {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        require(msg.sender == l.owner, "StelixVault: caller is not the lock owner");
        if (block.timestamp < l.unlockTime) revert NotMatured();
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        uint256 amount = l.amountRemaining;
        if (amount == 0) revert InvalidParams();
        l.amountRemaining = 0;
        l.status = LockStatus.Matured;
        require(IERC20(l.token).transfer(l.owner, amount), "StelixVault: payout failed");
        emit Matured(lockId, l.owner, amount);
        emit Unlocked(lockId, l.owner, amount, l.token);
    }

    /// @notice Keeper price poke (called by the keeper on its cron run,
    /// BEFORE executeTrigger). Records the highest TWAP seen so the
    /// trailing stop can arm. This must be a separate call because a
    /// reverted executeTrigger (target not due) would roll back a peak
    /// update made inside it — the peak would never be recorded.
    function pokePrice(uint256 lockId) external onlyKeeper {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        uint256 price = IPriceFeed(priceFeed).twapPrice(l.token, TWAP_WINDOW);
        if (price > l.peakPrice) l.peakPrice = price;
        emit PeakUpdated(lockId, l.peakPrice, price);
    }

    // ------------------------------------------------------------------
    // executeTrigger — KEEPER ONLY. Sells every due ladder stage and/or
    // the trailing-stop remainder. Re-checks the TWAP on-chain; the
    // keeper supplies no price. Failing swap => whole call reverts and
    // the lock stays exactly as it was (fail-safe; keeper retries).
    // ------------------------------------------------------------------
    function executeTrigger(uint256 lockId) external nonReentrant onlyKeeper {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        uint256 price = IPriceFeed(priceFeed).twapPrice(l.token, TWAP_WINDOW);
        if (price == 0) revert TriggerNotDue();
        if (price > l.peakPrice) l.peakPrice = price;

        bool anyStageSold;
        for (uint256 i; i < l.ladderStages.length; i++) {
            if (l.ladderStages[i].sold) continue;
            if (price < l.ladderStages[i].targetPrice) continue;
            uint256 stageAmount = (l.amountTotal * l.ladderStages[i].sellBps) / BPS_DENOMINATOR;
            if (stageAmount > l.amountRemaining) stageAmount = l.amountRemaining;
            if (stageAmount == 0) continue;
            l.ladderStages[i].sold = true; // effect before swap
            l.amountRemaining -= stageAmount;
            anyStageSold = true;
            emit TargetTriggered(lockId, i, l.ladderStages[i].targetPrice, price);
            _exitStage(l, lockId, i, stageAmount, price);
        }

        // Trailing stop: only armed after at least one stage has sold.
        bool trailingHit;
        if (
            l.trailingStopBps > 0 &&
            l.amountRemaining > 0 &&
            _anyStageSold(l) &&
            price <= (l.peakPrice * (BPS_DENOMINATOR - l.trailingStopBps)) / BPS_DENOMINATOR
        ) {
            trailingHit = true;
            uint256 remainder = l.amountRemaining;
            l.amountRemaining = 0;
            emit TrailingStopTriggered(lockId, l.peakPrice, price);
            _exitStage(l, lockId, type(uint256).max, remainder, price);
        }

        if (!anyStageSold && !trailingHit) revert TriggerNotDue();
        if (l.amountRemaining == 0) {
            l.status = LockStatus.Completed;
        } else {
            l.status = LockStatus.PartiallySold;
        }
    }

    /// @dev Performs one stage exit: auto-sell via the router, or unlock
    /// the tokens to the owner when autoSell is off. Called only from
    /// executeTrigger / claimTriggeredStage after state is updated.
    function _exitStage(Lock storage l, uint256 lockId, uint256 stageIndex, uint256 amount, uint256 price)
        internal
    {
        if (!l.autoSell) {
            require(IERC20(l.token).transfer(l.owner, amount), "StelixVault: payout failed");
            emit Unlocked(lockId, l.owner, amount, l.token);
            return;
        }
        // Expected stablecoin at the TWAP price, then slippage tolerance.
        uint256 expectedOut = (amount * price) / 1e18;
        uint256 amountOutMin = (expectedOut * (BPS_DENOMINATOR - l.slippageBps)) / BPS_DENOMINATOR;
        if (amountOutMin < l.minReceivePerStage) amountOutMin = l.minReceivePerStage;
        address[] memory path = new address[](2);
        path[0] = l.token;
        path[1] = l.stablecoin;
        require(IERC20(l.token).approve(l.router, amount), "StelixVault: approve failed");
        uint256[] memory amounts = IDexRouter(l.router).swapExactTokensForTokens(
            amount, amountOutMin, path, address(this), block.timestamp
        );
        uint256 received = amounts[amounts.length - 1];
        if (received < amountOutMin) revert MinReceiveNotMet();
        require(IERC20(l.token).approve(l.router, 0), "StelixVault: approve reset failed");
        uint256 fee;
        if (l.feeBps > 0 && feeRecipient != address(0)) {
            fee = (received * l.feeBps) / BPS_DENOMINATOR;
            require(IERC20(l.stablecoin).transfer(feeRecipient, fee), "StelixVault: fee failed");
        }
        uint256 payout = received - fee;
        require(IERC20(l.stablecoin).transfer(l.owner, payout), "StelixVault: payout failed");
        emit AutoSold(lockId, stageIndex, amount, payout, l.stablecoin);
    }

    /// @dev Manual path (pitch Part F): if a trigger has been met, the lock
    /// owner can always unlock that stage's tokens to their wallet and sell
    /// themselves — even if the keeper / swap is down. No swap, no fee.
    function claimTriggeredStage(uint256 lockId, uint256 stageIndex) external nonReentrant {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        require(msg.sender == l.owner, "StelixVault: caller is not the lock owner");
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        require(stageIndex < l.ladderStages.length, "StelixVault: bad stage");
        require(!l.ladderStages[stageIndex].sold, "StelixVault: stage already sold");
        uint256 price = IPriceFeed(priceFeed).twapPrice(l.token, TWAP_WINDOW);
        require(price >= l.ladderStages[stageIndex].targetPrice, "StelixVault: target not met");
        uint256 stageAmount = (l.amountTotal * l.ladderStages[stageIndex].sellBps) / BPS_DENOMINATOR;
        if (stageAmount > l.amountRemaining) stageAmount = l.amountRemaining;
        l.ladderStages[stageIndex].sold = true;
        l.amountRemaining -= stageAmount;
        if (price > l.peakPrice) l.peakPrice = price;
        if (l.amountRemaining == 0) l.status = LockStatus.Completed;
        else l.status = LockStatus.PartiallySold;
        require(IERC20(l.token).transfer(l.owner, stageAmount), "StelixVault: payout failed");
        emit TargetTriggered(lockId, stageIndex, l.ladderStages[stageIndex].targetPrice, price);
        emit Unlocked(lockId, l.owner, stageAmount, l.token);
    }

    // ------------------------------------------------------------------
    // Break flows — owner only, cooling-off, stored penalty exactly as
    // agreed at lock time. Immutable reverts entirely. Guardian is
    // Phase 2: request is recorded, execution reverts until enabled.
    // ------------------------------------------------------------------
    function requestBreak(uint256 lockId) external {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        require(msg.sender == l.owner, "StelixVault: caller is not the lock owner");
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        if (l.breakMode == BreakMode.Immutable) revert ImmutableLock();
        if (l.breakRequestedAt != 0) revert InvalidParams();
        l.breakRequestedAt = block.timestamp;
        uint256 delay =
            l.breakMode == BreakMode.Penalty ? PENALTY_COOLING_OFF : GUARDIAN_COOLING_OFF;
        emit BreakRequested(lockId, l.owner, block.timestamp + delay);
    }

    function executeBreak(uint256 lockId) external nonReentrant {
        Lock storage l = locks[lockId];
        require(l.owner != address(0), "StelixVault: lock does not exist");
        require(msg.sender == l.owner, "StelixVault: caller is not the lock owner");
        if (l.status != LockStatus.Active && l.status != LockStatus.PartiallySold) {
            revert InvalidParams();
        }
        if (l.breakMode == BreakMode.Immutable) revert ImmutableLock();
        if (l.breakMode == BreakMode.Guardian) revert GuardianBreakNotEnabled();
        if (l.breakRequestedAt == 0) revert BreakNotRequested();
        if (block.timestamp < l.breakRequestedAt + PENALTY_COOLING_OFF) {
            revert CoolingOffNotElapsed();
        }
        uint256 amount = l.amountRemaining;
        uint256 penalty = (amount * l.penaltyBps) / BPS_DENOMINATOR;
        uint256 returned = amount - penalty;
        l.amountRemaining = 0;
        l.status = LockStatus.Broken;
        l.breakRequestedAt = 0;
        if (penalty > 0) {
            address dest = l.penaltyRecipient == address(0) ? owner : l.penaltyRecipient;
            require(IERC20(l.token).transfer(dest, penalty), "StelixVault: penalty failed");
        }
        require(IERC20(l.token).transfer(l.owner, returned), "StelixVault: payout failed");
        emit Broken(lockId, l.owner, returned, penalty);
        emit Unlocked(lockId, l.owner, returned, l.token);
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------
    function getLock(uint256 lockId) external view returns (Lock memory) {
        require(locks[lockId].owner != address(0), "StelixVault: lock does not exist");
        return locks[lockId];
    }

    function getUserLocks(address user) external view returns (uint256[] memory) {
        return userLocks[user];
    }

    /// @notice Next unsold stage target, or 0 when none (pure date lock /
    /// all stages sold). Used by the app's target-progress bar.
    function nextTargetPrice(uint256 lockId) external view returns (uint256) {
        Lock storage l = locks[lockId];
        for (uint256 i; i < l.ladderStages.length; i++) {
            if (!l.ladderStages[i].sold) return l.ladderStages[i].targetPrice;
        }
        return 0;
    }

    function _anyStageSold(Lock storage l) internal view returns (bool) {
        for (uint256 i; i < l.ladderStages.length; i++) {
            if (l.ladderStages[i].sold) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Admin config ONLY — none of these can move locked funds.
    // There is deliberately NO withdraw / drain / rescue function.
    // ------------------------------------------------------------------
    function pauseNewLocks(bool paused) external onlyOwner {
        newLocksPaused = paused;
        emit NewLocksPaused(paused);
    }

    function setKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "keeper required");
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "router required");
        router = _router;
        emit RouterSet(_router);
    }

    function setPriceFeed(address _priceFeed) external onlyOwner {
        require(_priceFeed != address(0), "price feed required");
        priceFeed = _priceFeed;
        emit PriceFeedSet(_priceFeed);
    }

    function setPenaltyRecipient(address _penaltyRecipient) external onlyOwner {
        penaltyRecipient = _penaltyRecipient;
    }

    /// @notice Fee for NEW locks only; existing locks keep their snapshot.
    function setAutoSellFee(uint16 _feeBps, address _feeRecipient) external onlyOwner {
        require(_feeBps <= 1000, "fee too high");
        autoSellFeeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit AutoSellFeeSet(_feeBps, _feeRecipient);
    }

    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "owner required");
        owner = _owner;
    }
}
