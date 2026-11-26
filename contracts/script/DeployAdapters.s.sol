// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/adapters/UniswapV3TwapFeed.sol";
import "../src/adapters/StelixV3RouterAdapter.sol";

/// @notice Deploy the Arc-testnet adapters StelixVault needs.
/// All config comes from env vars; NO private key is ever committed.
///   RPC_URL, PRIVATE_KEY (deployer, testnet only in this flow),
///   USDC (Arc testnet USDC 0x3600000000000000000000000000000000000000),
///   V3_ROUTER (Uniswap V3 SwapRouter 0xfA845604F52843a7b5cfA4030120c6238741F420),
///   QUOTER (optional, V3 QuoterV2 — leave unset until a quoter address is
///   verified on testnet; the 0x3Ce95410... candidate is UNVERIFIED)
/// The deployer becomes the owner of both adapters (transfer ownership to
/// the vault owner / multisig after deployment with transferOwnership).
/// Output addresses feed DeployStelixVault.s.sol as PRICE_FEED + ROUTER.
contract DeployAdapters is Script {
    function run() external returns (UniswapV3TwapFeed feed, StelixV3RouterAdapter adapter) {
        address usdc = vm.envAddress("USDC");
        address v3Router = vm.envAddress("V3_ROUTER");
        address quoter = vm.envOr("QUOTER", address(0));

        vm.startBroadcast();
        feed = new UniswapV3TwapFeed(usdc, msg.sender);
        adapter = new StelixV3RouterAdapter(v3Router, msg.sender);
        if (quoter != address(0)) {
            adapter.setQuoter(quoter);
        }
        vm.stopBroadcast();

        console.log("UniswapV3TwapFeed deployed at:", address(feed));
        console.log("StelixV3RouterAdapter deployed at:", address(adapter));
        console.log("chain id:", block.chainid);
        console.log("NEXT: register pools on the feed (setPool per token),");
        console.log("then deploy the vault with ROUTER=<adapter> PRICE_FEED=<feed>.");
    }
}
