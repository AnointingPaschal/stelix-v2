// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/StelixVault.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockRouter.sol";
import "../src/mocks/MockPriceFeed.sol";

/// @notice StelixVault unit tests (Foundry). Covers the behaviours the
/// pitch requires: create, maturity claim, keeper trigger, ladder,
/// trailing stop, break modes, keeper-only access, no admin withdrawal,
/// and minimum-receive enforcement. Run: `forge test -vv`
contract StelixVaultTest is Test {
    StelixVault vault;
    MockERC20 token; // locked token, 18 dec, $1 entry
    MockERC20 usdt; // exit stablecoin, 18 dec in tests (6 dec on mainnet chains)
    MockRouter router;
    MockPriceFeed feed;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address user = makeAddr("user");
    address penaltyRecipient = makeAddr("penaltyRecipient");

    uint256 constant ENTRY = 1e18; // $1
    uint256 constant AMOUNT = 1000e18;

    function setUp() public {
        token = new MockERC20("Test Token", "TKN", 18);
        usdt = new MockERC20("Tether USD", "USDT", 18);
        router = new MockRouter();
        feed = new MockPriceFeed();
        vault = new StelixVault(
            owner, keeper, address(router), address(feed), penaltyRecipient, address(0), 0
        );
        token.mint(user, 100_000e18);
        usdt.mint(address(router), 10_000_000e18);
        feed.setPrice(address(token), ENTRY);
        router.setRate(address(token), ENTRY); // $1/token at entry
        vm.prank(user);
        token.approve(address(vault), type(uint256).max);
    }

    // -- helpers -------------------------------------------------------
    function _stages(uint256[] memory prices, uint16[] memory bps)
        internal
        pure
        returns (StelixVault.LadderStage[] memory s)
    {
        s = new StelixVault.LadderStage[](prices.length);
        for (uint256 i; i < prices.length; i++) {
            s[i] = StelixVault.LadderStage({targetPrice: prices[i], sellBps: bps[i], sold: false});
        }
    }

    function _create(
        StelixVault.LadderStage[] memory stages,
        uint16 trailingBps,
        StelixVault.BreakMode mode,
        uint16 penaltyBps,
        bool autoSell,
        uint256 minReceive
    ) internal returns (uint256 id) {
        vm.prank(user);
        id = vault.createLock(
            StelixVault.CreateLockParams({
                token: address(token),
                amount: AMOUNT,
                unlockTime: block.timestamp + 365 days,
                entryPrice: ENTRY,
                ladderStages: stages,
                trailingStopBps: trailingBps,
                breakMode: mode,
                penaltyBps: penaltyBps,
                autoSell: autoSell,
                stablecoin: address(usdt),
                slippageBps: 150,
                minReceivePerStage: minReceive
            })
        );
    }

    function _singleStageLock() internal returns (uint256 id) {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 10000;
        id = _create(_stages(p, b), 0, StelixVault.BreakMode.Penalty, 500, true, 0);
    }

    function _setMarket(uint256 price) internal {
        feed.setPrice(address(token), price);
        router.setRate(address(token), price);
    }

    // -- createLock ----------------------------------------------------
    function testCreateLockRecordsTermsAndPullsTokens() public {
        uint256 id = _singleStageLock();
        StelixVault.Lock memory l = vault.getLock(id);
        assertEq(l.owner, user);
        assertEq(l.token, address(token));
        assertEq(l.amountRemaining, AMOUNT);
        assertEq(l.entryPrice, ENTRY);
        assertEq(uint256(l.status), uint256(StelixVault.LockStatus.Active));
        assertEq(uint256(l.breakMode), uint256(StelixVault.BreakMode.Penalty));
        assertEq(l.penaltyBps, 500);
        assertTrue(l.autoSell);
        assertEq(token.balanceOf(address(vault)), AMOUNT);
        assertEq(vault.getUserLocks(user).length, 1);
        assertEq(vault.nextTargetPrice(id), 2e18);
    }

    function testCreateLockRevertsOnBadLadder() public {
        uint256[] memory p = new uint256[](2);
        p[0] = 2e18;
        p[1] = 3e18;
        uint16[] memory b = new uint16[](2);
        b[0] = 6000;
        b[1] = 6000; // totals 120% > 100%
        vm.expectRevert(StelixVault.InvalidParams.selector);
        _create(_stages(p, b), 0, StelixVault.BreakMode.Penalty, 500, true, 0);
    }

    function testCreateLockRevertsWhenPaused() public {
        vm.prank(owner);
        vault.pauseNewLocks(true);
        vm.expectRevert(StelixVault.InvalidParams.selector);
        _singleStageLock();
    }

    // -- maturity claim -------------------------------------------------
    function testClaimMaturedRevertsBeforeUnlockTime() public {
        uint256 id = _singleStageLock();
        vm.prank(user);
        vm.expectRevert(StelixVault.NotMatured.selector);
        vault.claimMatured(id);
    }

    function testClaimMaturedReturnsTokensAfterUnlockTime() public {
        uint256 id = _singleStageLock();
        vm.warp(block.timestamp + 365 days + 1);
        uint256 before = token.balanceOf(user);
        vm.prank(user);
        vault.claimMatured(id);
        assertEq(token.balanceOf(user) - before, AMOUNT);
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.Matured));
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testClaimMaturedOnlyOwner() public {
        uint256 id = _singleStageLock();
        vm.warp(block.timestamp + 365 days + 1);
        vm.prank(keeper);
        vm.expectRevert("StelixVault: caller is not the lock owner");
        vault.claimMatured(id);
    }

    // -- keeper trigger -------------------------------------------------
    function testExecuteTriggerRevertsWhenNotKeeper() public {
        uint256 id = _singleStageLock();
        _setMarket(2e18);
        vm.prank(user);
        vm.expectRevert("StelixVault: caller is not the keeper");
        vault.executeTrigger(id);
    }

    function testExecuteTriggerRevertsWhenTargetNotMet() public {
        uint256 id = _singleStageLock();
        _setMarket(199e16); // $1.99 < $2 target (TWAP, not a spot wick)
        vm.prank(keeper);
        vm.expectRevert(StelixVault.TriggerNotDue.selector);
        vault.executeTrigger(id);
    }

    function testPriceTargetTriggerAutoSellsToUSDT() public {
        uint256 id = _singleStageLock();
        _setMarket(2e18);
        uint256 before = usdt.balanceOf(user);
        vm.prank(keeper);
        vault.executeTrigger(id);
        // 1000 tokens @ $2 = 2000 USDT, no fee at launch
        assertEq(usdt.balanceOf(user) - before, 2000e18);
        StelixVault.Lock memory l = vault.getLock(id);
        assertEq(l.amountRemaining, 0);
        assertEq(uint256(l.status), uint256(StelixVault.LockStatus.Completed));
    }

    function testTriggerWithAutoSellOffUnlocksTokensUnsold() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 10000;
        uint256 id = _create(_stages(p, b), 0, StelixVault.BreakMode.Penalty, 500, false, 0);
        _setMarket(2e18);
        uint256 before = token.balanceOf(user);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(token.balanceOf(user) - before, AMOUNT);
        assertEq(usdt.balanceOf(user), 0);
    }

    // -- ladder ---------------------------------------------------------
    function testLadderPartialSell() public {
        uint256[] memory p = new uint256[](3);
        p[0] = 2e18;
        p[1] = 3e18;
        p[2] = 5e18;
        uint16[] memory b = new uint16[](3);
        b[0] = 2500;
        b[1] = 2500;
        b[2] = 5000;
        uint256 id = _create(_stages(p, b), 0, StelixVault.BreakMode.Penalty, 500, true, 0);

        _setMarket(2e18);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 250e18 * 2); // 250 tokens @ $2
        assertEq(vault.getLock(id).amountRemaining, 750e18);
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.PartiallySold));

        _setMarket(3e18);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 500e18 + 750e18); // +250 @ $3
        assertEq(vault.getLock(id).amountRemaining, 500e18);

        _setMarket(5e18);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 1250e18 + 2500e18); // +500 @ $5
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.Completed));
    }

    // -- trailing stop ---------------------------------------------------
    function testTrailingStopSellsRemainderAfterPeakFall() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 2500; // 25% at 2x, rest rides the trailing stop
        uint256 id = _create(_stages(p, b), 1000, StelixVault.BreakMode.Penalty, 500, true, 0);

        _setMarket(2e18);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 500e18);

        // Price runs to $3: keeper pokes the peak to $3 (a bare
        // executeTrigger here would revert as not-due and roll the peak
        // update back — see pokePrice docs), then no sale is due.
        _setMarket(3e18);
        vm.prank(keeper);
        vault.pokePrice(id);
        assertEq(vault.getLock(id).peakPrice, 3e18);
        vm.prank(keeper);
        vm.expectRevert(StelixVault.TriggerNotDue.selector);
        vault.executeTrigger(id);

        // Price falls 13.3% from the $3 peak to $2.60 — past the 10% stop.
        _setMarket(26e17);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 500e18 + 750e18 * 26 / 10); // 750 @ $2.60
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.Completed));
    }

    function testTrailingStopDoesNotFireBeforeAnyStageSold() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 2500;
        uint256 id = _create(_stages(p, b), 1000, StelixVault.BreakMode.Penalty, 500, true, 0);
        // Price falls below entry with no stage ever sold: nothing to trail.
        _setMarket(8e17);
        vm.prank(keeper);
        vm.expectRevert(StelixVault.TriggerNotDue.selector);
        vault.executeTrigger(id);
    }

    // -- break modes -----------------------------------------------------
    function testImmutableBreakReverts() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 10000;
        uint256 id = _create(_stages(p, b), 0, StelixVault.BreakMode.Immutable, 0, true, 0);
        vm.prank(user);
        vm.expectRevert(StelixVault.ImmutableLock.selector);
        vault.requestBreak(id);
        vm.prank(user);
        vm.expectRevert(StelixVault.ImmutableLock.selector);
        vault.executeBreak(id);
    }

    function testPenaltyBreakAfterCoolingOff() public {
        uint256 id = _singleStageLock();
        vm.prank(user);
        vault.requestBreak(id);
        vm.warp(block.timestamp + 23 hours);
        vm.prank(user);
        vm.expectRevert(StelixVault.CoolingOffNotElapsed.selector);
        vault.executeBreak(id);

        vm.warp(block.timestamp + 1 hours + 1); // 24h total
        uint256 userBefore = token.balanceOf(user);
        uint256 penBefore = token.balanceOf(penaltyRecipient);
        vm.prank(user);
        vault.executeBreak(id);
        assertEq(token.balanceOf(user) - userBefore, 950e18); // 5% penalty
        assertEq(token.balanceOf(penaltyRecipient) - penBefore, 50e18);
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.Broken));
    }

    function testPenaltyBreakWithoutRequestReverts() public {
        uint256 id = _singleStageLock();
        vm.prank(user);
        vm.expectRevert(StelixVault.BreakNotRequested.selector);
        vault.executeBreak(id);
    }

    function testGuardianBreakIsPhase2NotEnabled() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 10000;
        uint256 id = _create(_stages(p, b), 0, StelixVault.BreakMode.Guardian, 0, true, 0);
        vm.prank(user);
        vault.requestBreak(id); // request is recorded (48h clock)
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(user);
        vm.expectRevert(StelixVault.GuardianBreakNotEnabled.selector);
        vault.executeBreak(id);
    }

    // -- guards ----------------------------------------------------------
    function testMinReceiveRevertLeavesLockUntouched() public {
        uint256[] memory p = new uint256[](1);
        p[0] = 2e18;
        uint16[] memory b = new uint16[](1);
        b[0] = 10000;
        // minReceive 10,000 USDT can never be met by a 2,000 USDT sale.
        uint256 id = _create(_stages(p, b), 0, StelixVault.BreakMode.Penalty, 500, true, 10_000e18);
        _setMarket(2e18);
        vm.prank(keeper);
        vm.expectRevert(); // MockRouter: insufficient output
        vault.executeTrigger(id);
        StelixVault.Lock memory l = vault.getLock(id);
        assertEq(l.amountRemaining, AMOUNT);
        assertEq(uint256(l.status), uint256(StelixVault.LockStatus.Active));
        assertEq(usdt.balanceOf(user), 0);
    }

    function testSwapFailureIsFailSafe() public {
        uint256 id = _singleStageLock();
        _setMarket(2e18);
        router.setFailing(true);
        vm.prank(keeper);
        vm.expectRevert("MockRouter: swap failed");
        vault.executeTrigger(id);
        assertEq(vault.getLock(id).amountRemaining, AMOUNT);
        // Keeper retries once the router works again.
        router.setFailing(false);
        vm.prank(keeper);
        vault.executeTrigger(id);
        assertEq(usdt.balanceOf(user), 2000e18);
    }

    function testNoAdminWithdrawalFunction() public {
        // There is deliberately no withdraw/drain/rescue function: low-level
        // calls to every plausible drain selector must fail.
        bytes[] memory selectors = new bytes[](4);
        selectors[0] = abi.encodeWithSignature("withdraw()");
        selectors[1] = abi.encodeWithSignature("withdraw(uint256)");
        selectors[2] = abi.encodeWithSignature("emergencyWithdraw()");
        selectors[3] = abi.encodeWithSignature("rescueTokens(address,uint256)");
        for (uint256 i; i < selectors.length; i++) {
            vm.prank(owner);
            (bool ok,) = address(vault).call(selectors[i]);
            assertFalse(ok, "drain function must not exist");
        }
        // And admin config calls cannot move funds either.
        _singleStageLock();
        uint256 vaultBal = token.balanceOf(address(vault));
        vm.prank(owner);
        vault.setKeeper(makeAddr("newKeeper"));
        vm.prank(owner);
        vault.pauseNewLocks(true);
        assertEq(token.balanceOf(address(vault)), vaultBal);
    }

    function testManualTriggeredStageClaim() public {
        uint256 id = _singleStageLock();
        _setMarket(2e18);
        uint256 before = token.balanceOf(user);
        vm.prank(user);
        vault.claimTriggeredStage(id, 0);
        assertEq(token.balanceOf(user) - before, AMOUNT);
        assertEq(uint256(vault.getLock(id).status), uint256(StelixVault.LockStatus.Completed));
    }
}
