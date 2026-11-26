// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/launchpad/StelixTokenFactory.sol";
import "../src/launchpad/StelixLaunchpad.sol";

/// @notice Deploy the Stelix launchpad (token factory + fixed-price sale)
/// to Arc testnet. No launch fee — gas only.
/// All config comes from env vars; NO private key is ever committed.
///   RPC_URL, PRIVATE_KEY (deployer, testnet only in this flow),
///   USDC (Arc testnet USDC 0x3600000000000000000000000000000000000000)
/// The deployer becomes the owner of the launchpad (setLiquidityManager
/// stays unset until a DEX route for launch liquidity is confirmed).
contract DeployLaunchpad is Script {
    function run() external returns (StelixTokenFactory factory, StelixLaunchpad launchpad) {
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast();
        factory = new StelixTokenFactory();
        launchpad = new StelixLaunchpad(usdc, msg.sender);
        vm.stopBroadcast();

        console.log("StelixTokenFactory deployed at:", address(factory));
        console.log("StelixLaunchpad deployed at:", address(launchpad));
        console.log("chain id:", block.chainid);
        console.log("NEXT: verify on testnet.arcscan.app, then register both");
        console.log("addresses in the admin Chain Manager (deployments table).");
        console.log("Liquidity: releaseLiquidity stays locked until a liquidity");
        console.log("manager is set (pending Arc DEX confirmation).");
    }
}
