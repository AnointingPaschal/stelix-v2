// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/adapters/PancakeV2TwapFeed.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockV2Pair.sol";

/// @notice PancakeV2TwapFeed unit tests (Foundry).
/// Covers: price math in both token orientations and both stablecoin
/// decimal cases (18-dec BUSD-style, 6-dec USDT-style), the snapshot /
/// window rules (no observation, too-short observation), and the
/// owner-only pair registration. Run: `forge test --match-contract PancakeV2TwapFeedTest -vv`
contract PancakeV2TwapFeedTest is Test {
    uint256 constant Q112 = 1 << 112;

    MockERC20 token; // 18 dec
    MockERC20 stable18; // 18 dec, BUSD-style (testnet case)
    MockERC20 stable6; // 6 dec, USDT-style (mainnet case)
    MockV2Pair pair18;
    MockV2Pair pair6;
    PancakeV2TwapFeed feed18;
    PancakeV2TwapFeed feed6;

    address owner = makeAddr("owner");
    address user = makeAddr("user");

    function setUp() public {
        token = new MockERC20("Token", "TKN", 18);
        stable18 = new MockERC20("BUSD", "BUSD", 18);
        stable6 = new MockERC20("USDT", "USDT", 6);
        // token is token0 in pair18, token1 in pair6 — both orientations.
        pair18 = new MockV2Pair(address(token), address(stable18));
        pair6 = new MockV2Pair(address(stable6), address(token));
        feed18 = new PancakeV2TwapFeed(address(stable18), 18, owner);
        feed6 = new PancakeV2TwapFeed(address(stable6), 6, owner);
        vm.prank(owner);
        feed18.setPair(address(token), address(pair18), 18);
        vm.prank(owner);
        feed6.setPair(address(token), address(pair6), 18);
    }

    /// @notice Snapshot at t, then a constant $2 price for 1800s.
    /// 18-dec token / 18-dec stable: mean = 2 * 2^112, price = 2e18.
    function testTwapTwoDollars18DecStable() public {
        feed18.update(address(token));
        vm.warp(block.timestamp + 1800);
        pair18.setConstantPrice(address(token), 2 * Q112, 1800);
        assertEq(feed18.twapPrice(address(token), 1800), 2e18);
        assertEq(feed18.latestPrice(address(token)), 2e18);
    }

    /// @notice $3 price, token as token1, 6-dec token / 6-dec USDT stable:
    /// mean = 3 * 2^112, priceRaw = 3e6, * 1e12 = 3e18.
    function testTwapToken1Orientation6DecToken() public {
        MockERC20 token6 = new MockERC20("Token6", "TK6", 6);
        MockV2Pair p = new MockV2Pair(address(stable6), address(token6));
        vm.prank(owner);
        feed6.setPair(address(token6), address(p), 6);
        feed6.update(address(token6));
        vm.warp(block.timestamp + 1800);
        // $3, token1 orientation, 6-dec token / 6-dec stable: mean = 3 * 2^112.
        p.setConstantPrice(address(token6), 3 * Q112, 1800);
        assertEq(feed6.twapPrice(address(token6), 1800), 3e18);
    }

    function testTwapRevertsWithoutObservation() public {
        vm.expectRevert(abi.encodeWithSignature("ObservationMissing()"));
        feed18.twapPrice(address(token), 1800);
    }

    function testTwapRevertsWhenObservationTooShort() public {
        feed18.update(address(token));
        vm.warp(block.timestamp + 60);
        pair18.setConstantPrice(address(token), 2 * Q112, 60);
        vm.expectRevert(abi.encodeWithSignature("ObservationTooShort()"));
        feed18.twapPrice(address(token), 1800);
    }

    function testTwapRevertsWithoutPair() public {
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSignature("PoolNotSet()"));
        feed18.twapPrice(unknown, 1800);
    }

    function testUpdateRevertsWithoutPair() public {
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSignature("PoolNotSet()"));
        feed18.update(unknown);
    }

    function testFeedRejectsNonStablePair() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockV2Pair bad = new MockV2Pair(address(token), address(other));
        vm.prank(owner);
        vm.expectRevert("pair is not token/STABLE");
        feed18.setPair(address(token), address(bad), 18);
    }

    function testFeedOnlyOwnerCanSetPair() public {
        vm.expectRevert("PancakeV2TwapFeed: not owner");
        feed18.setPair(address(token), address(pair18), 18);
    }

    function testFeedOnlyOwnerCanTransfer() public {
        vm.expectRevert("PancakeV2TwapFeed: not owner");
        feed18.transferOwnership(user);
    }
}
