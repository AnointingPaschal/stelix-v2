// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/vendor/TickMath.sol";
import "../src/adapters/UniswapV3TwapFeed.sol";
import "../src/adapters/StelixV3RouterAdapter.sol";
import "../src/StelixVault.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockV3Pool.sol";
import "../src/mocks/MockV3Router.sol";

/// @notice Exposes the internal TickMath library for testing.
contract TickMathHarness {
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }
}

/// @notice Adapter unit + integration tests (Foundry).
/// Covers: vendored TickMath against Python-computed vectors, the V3 TWAP
/// feed price math in both token orientations, the V3 router adapter
/// (swap / quoter / fees), and the full vault path on the V3 stack with a
/// 6-decimal USDC exit (the Arc case). Run: `forge test -vv`
contract AdaptersTest is Test {
    TickMathHarness tickMath;
    MockERC20 token; // 18 dec
    MockERC20 usdc; // 6 dec, like Arc testnet USDC
    MockV3Pool pool;
    UniswapV3TwapFeed feed;
    MockV3Router v3router;
    MockQuoterV2 quoter;
    StelixV3RouterAdapter adapter;

    address owner = makeAddr("owner");
    address user = makeAddr("user");

    function setUp() public {
        tickMath = new TickMathHarness();
        token = new MockERC20("Test Token", "TKN", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        // token0 = token, token1 = usdc (sorted by address? NO — the mock
        // takes them as given; the feed only requires {token, USDC}).
        pool = new MockV3Pool(address(token), address(usdc));
        feed = new UniswapV3TwapFeed(address(usdc), owner);
        vm.prank(owner);
        feed.setPool(address(token), address(pool), 18);

        v3router = new MockV3Router();
        quoter = new MockQuoterV2();
        adapter = new StelixV3RouterAdapter(address(v3router), owner);
        usdc.mint(address(v3router), 10_000_000e6);
    }

    // -- TickMath vectors (Python-computed, exact) -----------------------
    // TickMath rounds the final division UP, so the contract value may
    // exceed the exact floor value by at most 1. Assert within 1.
    function _assertTick(int24 tick, uint256 expected) internal {
        uint256 actual = tickMath.sqrtRatioAtTick(tick);
        uint256 diff = actual >= expected ? actual - expected : expected - actual;
        assertLe(diff, 1);
    }

    function testTickMathVectors() public {
        _assertTick(0, 79228162514264337593543950336);
        _assertTick(1, 79232123823359799118286999567);
        _assertTick(-1, 79224201403219477170569942573);
        _assertTick(100, 79625275426524748796330556127);
        _assertTick(-100, 78833030112140176575862854578);
        _assertTick(1000, 83290069058676223003182343269);
        _assertTick(123456, 37980312163600838849089827163597);
        _assertTick(-269380, 112113952375538773969050);
        _assertTick(50000, 965075977353221155028623082915);
        _assertTick(-50000, 6504256538020985011912221506);
    }

    // -- TWAP feed ---------------------------------------------------------
    function testFeedTickZeroIsOneToOneRaw() public {
        // tick 0, token0: raw 1:1 -> 1 whole token = 1e18 micro-USDC = 1e12 USDC.
        pool.setMeanTick(0, 1800);
        assertEq(feed.twapPrice(address(token), 1800), 1e30);
        assertEq(feed.latestPrice(address(token)), 1e30);
    }

    function testFeedToken0ApproxTwoDollars() public {
        // Mean tick -269380 -> ~$2.002442 for an 18-dec token as token0.
        pool.setMeanTick(-269380, 1800);
        uint256 price = feed.twapPrice(address(token), 1800);
        assertApproxEqRel(price, 2002442000000000000, 1e14); // within 0.01%
    }

    function testFeedToken1Orientation() public {
        // Same pool flipped: token is token1 now. Tick -100000 is a very
        // high raw price (see Python vectors); the point is the orientation
        // math, checked against the independently computed value.
        MockV3Pool flipped = new MockV3Pool(address(usdc), address(token));
        flipped.setMeanTick(-100000, 1800);
        vm.prank(owner);
        feed.setPool(address(token), address(flipped), 18);
        uint256 price = feed.twapPrice(address(token), 1800);
        // Python: token1-price18 at tick -100000 = 22015456048552198645701000000000000
        assertApproxEqRel(price, 22015456048552198645701000000000000, 1e14);
    }

    function testFeedRevertsWithoutPool() public {
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSignature("PoolNotSet()"));
        feed.twapPrice(unknown, 1800);
    }

    function testFeedRejectsNonUsdcPool() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockV3Pool bad = new MockV3Pool(address(token), address(other));
        vm.prank(owner);
        vm.expectRevert("pool is not token/USDC");
        feed.setPool(address(token), address(bad), 18);
    }

    function testFeedOnlyOwnerCanSetPool() public {
        vm.expectRevert("UniswapV3TwapFeed: not owner");
        feed.setPool(address(token), address(pool), 18);
    }

    // -- router adapter ------------------------------------------------------
    function testAdapterSwap() public {
        MockERC20 stable18 = new MockERC20("Stable18", "S18", 18);
        stable18.mint(address(v3router), 10_000_000e18);
        v3router.setRate(address(token), 2e18); // 1 token -> 2 stable
        token.mint(address(this), 100e18);
        token.approve(address(adapter), 100e18);
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = address(stable18);
        uint256[] memory out = adapter.swapExactTokensForTokens(100e18, 190e18, path, address(this), block.timestamp);
        assertEq(out[1], 200e18);
        assertEq(stable18.balanceOf(address(this)), 200e18);
    }

    function testAdapterQuoteNeedsQuoter() public {
        address[] memory path = new address[](2);
        path[0] = address(token);
        path[1] = address(usdc);
        vm.expectRevert(abi.encodeWithSignature("QuoterNotSet()"));
        adapter.getAmountsOut(100e18, path);
        vm.prank(owner);
        adapter.setQuoter(address(quoter));
        quoter.setRate(address(token), 2e18);
        uint256[] memory out = adapter.getAmountsOut(100e18, path);
        assertEq(out[1], 200e18);
    }

    function testAdapterDefaultFeeAndSetFee() public {
        assertEq(adapter.feeFor(address(token), address(usdc)), 3000);
        vm.prank(owner);
        adapter.setFee(address(token), address(usdc), 500);
        assertEq(adapter.feeFor(address(token), address(usdc)), 500);
    }

    // -- vault end-to-end on the V3 stack, 6-dec USDC -----------------------
    function testVaultEndToEndViaV3With6DecUsdc() public {
        // Vault points at the adapter (as its router) and the TWAP feed.
        // This test contract is the keeper.
        StelixVault vault = new StelixVault(
            owner, address(this), address(adapter), address(feed), address(0), address(0), 0
        );
        // Mock V3 router pays $2 per token in 6-dec USDC: rate 2e6.
        v3router.setRate(address(token), 2e6);
        token.mint(user, 100_000e18);
        vm.prank(user);
        token.approve(address(vault), type(uint256).max);

        StelixVault.LadderStage[] memory stages = new StelixVault.LadderStage[](1);
        stages[0] = StelixVault.LadderStage({targetPrice: 2e18, sellBps: 10000, sold: false});
        vm.prank(user);
        uint256 lockId = vault.createLock(
            StelixVault.CreateLockParams({
                token: address(token),
                amount: 1000e18,
                unlockTime: block.timestamp + 365 days,
                entryPrice: 1e18,
                ladderStages: stages,
                trailingStopBps: 0,
                breakMode: StelixVault.BreakMode.Immutable,
                penaltyBps: 0,
                autoSell: true,
                stablecoin: address(usdc),
                slippageBps: 150,
                minReceivePerStage: 0
            })
        );
        // Price target NOT met yet: TWAP ~$1 -> trigger reverts.
        // (tick -276319 is ~$1.0004 for an 18-dec token as token0.)
        pool.setMeanTick(-276319, 1800);
        vm.expectRevert(abi.encodeWithSignature("TriggerNotDue()"));
        vault.executeTrigger(lockId);

        // TWAP rises to ~$2.0024 -> target $2 met -> auto-sell 1000 tokens.
        pool.setMeanTick(-269380, 1800);
        vault.executeTrigger(lockId);
        // User receives 1000 tokens * $2 = 2,000 USDC (6 dec).
        assertEq(usdc.balanceOf(user), 2000e6);
        assertEq(uint256(vault.getLock(lockId).status), uint256(StelixVault.LockStatus.Completed));
    }
}
