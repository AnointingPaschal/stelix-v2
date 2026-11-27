// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/adapters/PancakeV2TwapFeed.sol";

/// @notice Deploy the V2 TWAP price feed StelixVault needs on V2 chains
/// (BNB Testnet, Ethereum Sepolia). All config comes from env vars;
/// NO private key is ever committed.
///   RPC_URL, PRIVATE_KEY (deployer, testnet only in this flow),
///   STABLE (exit stablecoin: BUSD 0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7
///     on BNB Testnet, USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 on Sepolia),
///   STABLE_DECIMALS (18 for BUSD, 6 for USDC)
/// The deployer becomes the owner of the feed (transfer ownership to
/// the vault owner / multisig after deployment with transferOwnership).
/// The Router needs NO adapter on a V2 chain — the vault speaks V2
/// natively, so the vault's ROUTER is the V2 router itself.
/// Output address feeds DeployStelixVault.s.sol as PRICE_FEED.
contract DeployV2Feed is Script {
    function run() external returns (PancakeV2TwapFeed feed) {
        address stable = vm.envAddress("STABLE");
        uint8 stableDecimals = uint8(vm.envUint("STABLE_DECIMALS"));

        vm.startBroadcast();
        feed = new PancakeV2TwapFeed(stable, stableDecimals, msg.sender);
        vm.stopBroadcast();

        console.log("PancakeV2TwapFeed deployed at:", address(feed));
        console.log("chain id:", block.chainid);
        console.log("NEXT: register pairs on the feed (setPair per token),");
        console.log("then update(token) and wait 30 minutes before TWAP reads work,");
        console.log("then deploy the vault with ROUTER=<V2 router> PRICE_FEED=<feed>.");
    }
}
