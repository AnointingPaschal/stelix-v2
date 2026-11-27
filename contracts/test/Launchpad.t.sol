// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/launchpad/StelixTokenFactory.sol";
import "../src/launchpad/StelixLaunchpad.sol";
import "../src/launchpad/LaunchToken.sol";
import "../src/mocks/MockERC20.sol";

/// @notice Launchpad unit tests (Foundry). Covers: factory creation +
/// validation, sale creation + token deposit, contributions + progress,
/// success flow (claim / seller withdraw / liquidity earmark + release),
/// failure flow (full refunds), and double-spend guards. Run: `forge test -vv`
contract LaunchpadTest is Test {
    StelixTokenFactory factory;
    StelixLaunchpad launchpad;
    MockERC20 usdc; // 6 decimals, like Arc testnet USDC

    address seller = makeAddr("seller");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address manager = makeAddr("liquidityManager");

    uint256 constant PRICE = 100_000; // 0.10 USDC per whole token (micro-USDC)
    uint256 constant SOFT = 1_000_000_000; // 1,000 USDC
    uint256 constant HARD = 10_000_000_000; // 10,000 USDC
    uint256 constant FOR_SALE = 100_000e18; // 100,000 tokens cover the hard cap

    address token;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        factory = new StelixTokenFactory();
        launchpad = new StelixLaunchpad(address(usdc), address(this));

        // Seller creates a token via the factory: 1,000,000 supply, 18 dec.
        vm.prank(seller);
        token = factory.createToken("Stelix Test", "STEST", 1_000_000e18, 18, "https://stelix-admin.pages.dev/api/logo/testlogo");

        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);
        vm.prank(alice);
        usdc.approve(address(launchpad), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(launchpad), type(uint256).max);
        vm.prank(seller);
        LaunchToken(token).approve(address(launchpad), type(uint256).max);
    }

    function _createSale(uint16 liquidityBps) internal returns (uint256 id) {
        uint256 start = block.timestamp + 100;
        uint256 end = start + 7 days;
        vm.prank(seller);
        id = launchpad.createLaunch(token, PRICE, SOFT, HARD, start, end, liquidityBps, FOR_SALE);
    }

    function _contribute(address user, uint256 saleId, uint256 amount) internal {
        vm.prank(user);
        launchpad.contribute(saleId, amount);
    }

    // -- factory -------------------------------------------------------
    function testFactoryCreatesTokenWithSupplyToCreator() public {
        vm.prank(seller);
        address t = factory.createToken("Another", "ANO", 500e18, 6, "");
        assertEq(LaunchToken(t).balanceOf(seller), 500e18);
        assertEq(LaunchToken(t).decimals(), 6);
        assertTrue(factory.isFactoryToken(t));
        assertEq(factory.tokenCount(), 2);
    }

    // -- on-chain logo ---------------------------------------------------
    function testFactoryRecordsLogoURIOnChain() public {
        StelixTokenFactory.TokenInfo memory info = factory.getTokenByAddress(token);
        assertEq(info.logoURI, "https://stelix-admin.pages.dev/api/logo/testlogo");
        assertEq(info.name, "Stelix Test");
        assertEq(info.symbol, "STEST");
        assertEq(factory.getToken(0).logoURI, "https://stelix-admin.pages.dev/api/logo/testlogo");
        // A token created without a logo records an empty logoURI.
        vm.prank(seller);
        address t = factory.createToken("No Logo", "NOLOGO", 1e18, 18, "");
        assertEq(factory.getTokenByAddress(t).logoURI, "");
        assertEq(factory.getTokenByAddress(address(0x1234)).token, address(0));
    }

    function testFactoryRejectsBadParams() public {
        vm.prank(seller);
        vm.expectRevert("name required");
        factory.createToken("", "X", 1e18, 18, "");
        vm.prank(seller);
        vm.expectRevert("supply required");
        factory.createToken("X", "X", 0, 18, "");
        vm.prank(seller);
        vm.expectRevert("decimals > 18");
        factory.createToken("X", "X", 1e18, 19, "");
    }

    // -- sale creation ---------------------------------------------------
    function testCreateLaunchDepositsTokens() public {
        uint256 id = _createSale(2000);
        assertEq(LaunchToken(token).balanceOf(address(launchpad)), FOR_SALE);
        (uint256 raised, , , , , ) = launchpad.progress(id);
        assertEq(raised, 0);
    }

    function testCreateLaunchRejectsUncoveredHardCap() public {
        uint256 start = block.timestamp + 100;
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSignature("InvalidParams()"));
        launchpad.createLaunch(token, PRICE, SOFT, HARD, start, start + 7 days, 2000, 100e18);
    }

    function testCreateLaunchRejectsBadCapsAndTimesAndLiquidity() public {
        uint256 start = block.timestamp + 100;
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSignature("InvalidParams()"));
        launchpad.createLaunch(token, PRICE, HARD, SOFT, start, start + 7 days, 2000, FOR_SALE);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSignature("InvalidParams()"));
        launchpad.createLaunch(token, PRICE, SOFT, HARD, start, start, 2000, FOR_SALE);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSignature("InvalidParams()"));
        launchpad.createLaunch(token, PRICE, SOFT, HARD, start, start + 7 days, 5001, FOR_SALE);
    }

    // -- contributions + progress ---------------------------------------
    function testContributeAndProgress() public {
        uint256 id = _createSale(2000);
        vm.warp(block.timestamp + 200);
        _contribute(alice, id, 10_000_000); // 10 USDC
        _contribute(bob, id, 5_000_000); // 5 USDC
        (uint256 raised, uint256 soft, uint256 hard, uint256 pct, uint256 n, uint256 sold) =
            launchpad.progress(id);
        assertEq(raised, 15_000_000);
        assertEq(soft, SOFT);
        assertEq(hard, HARD);
        assertEq(pct, 15); // 15 USDC / 10,000 USDC = 0.15% -> 15 bps
        assertEq(n, 2);
        assertEq(sold, 150e18); // 15 USDC at $0.10 = 150 tokens
        assertEq(launchpad.tokensOwed(id, alice), 100e18);
    }

    function testContributeRevertsOutsideWindowAndOverHardCap() public {
        uint256 id = _createSale(2000);
        vm.expectRevert(abi.encodeWithSignature("SaleNotActive()"));
        _contribute(alice, id, 10_000_000); // before start
        vm.warp(block.timestamp + 200);
        vm.expectRevert(abi.encodeWithSignature("InvalidParams()"));
        vm.prank(alice);
        launchpad.contribute(id, HARD + 1);
    }

    // -- success flow -----------------------------------------------------
    function testSuccessFlowClaimWithdrawAndLiquidity() public {
        uint256 id = _createSale(2000); // 20% liquidity lock
        vm.warp(block.timestamp + 200);
        _contribute(alice, id, 3_000_000_000); // 3,000 USDC
        _contribute(bob, id, 2_000_000_000); // 2,000 USDC -> raised 5,000
        vm.warp(block.timestamp + 8 days);
        launchpad.finalize(id);

        StelixLaunchpad.Sale memory s = launchpad.getSale(id);
        assertEq(uint256(s.status), uint256(StelixLaunchpad.SaleStatus.Success));
        assertEq(s.liquidityReserveStable, 1_000_000_000); // 20% of 5,000
        assertEq(s.liquidityReserveTokens, 10_000e18); // 1,000 USDC worth

        // Contributors claim tokens.
        uint256 aliceBefore = LaunchToken(token).balanceOf(alice);
        vm.prank(alice);
        launchpad.claim(id);
        assertEq(LaunchToken(token).balanceOf(alice) - aliceBefore, 30_000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("AlreadyClaimed()"));
        launchpad.claim(id);

        // Seller withdraws raised minus reserve: 4,000 USDC. No fee taken.
        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.prank(seller);
        launchpad.withdrawRaised(id);
        assertEq(usdc.balanceOf(seller) - sellerBefore, 4_000_000_000);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSignature("AlreadyClaimed()"));
        launchpad.withdrawRaised(id);

        // Liquidity release is blocked until a manager is set.
        vm.expectRevert(abi.encodeWithSignature("LiquidityNotReady()"));
        launchpad.releaseLiquidity(id);
        launchpad.setLiquidityManager(manager);
        launchpad.releaseLiquidity(id);
        assertEq(usdc.balanceOf(manager), 1_000_000_000);
        assertEq(LaunchToken(token).balanceOf(manager), 10_000e18);

        // Unsold tokens return to the seller: 100,000 - 50,000 sold - 10,000 reserve.
        vm.prank(seller);
        launchpad.withdrawUnsoldTokens(id);
        assertEq(LaunchToken(token).balanceOf(seller), 1_000_000e18 - FOR_SALE + 40_000e18);
    }

    // -- failure flow -----------------------------------------------------
    function testUnsuccessfulSaleFullRefunds() public {
        uint256 id = _createSale(2000);
        vm.warp(block.timestamp + 200);
        _contribute(alice, id, 500_000_000); // 500 USDC < 1,000 soft cap
        vm.warp(block.timestamp + 8 days);
        launchpad.finalize(id);
        StelixLaunchpad.Sale memory s = launchpad.getSale(id);
        assertEq(uint256(s.status), uint256(StelixLaunchpad.SaleStatus.Failed));

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        launchpad.refund(id);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 500_000_000);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("AlreadyClaimed()"));
        launchpad.refund(id);

        // Seller gets the deposited tokens back in full.
        vm.prank(seller);
        launchpad.withdrawUnsoldTokens(id);
        assertEq(LaunchToken(token).balanceOf(seller), 1_000_000e18);
    }

    function testClaimBeforeFinalizeReverts() public {
        uint256 id = _createSale(0);
        vm.warp(block.timestamp + 200);
        _contribute(alice, id, 10_000_000);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("SaleNotFinalized()"));
        launchpad.claim(id);
    }
}
