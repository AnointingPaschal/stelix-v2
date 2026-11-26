// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/StelixVault.sol";

/// @notice Deploy StelixVault to any EVM chain (testnet first — see README).
/// All config comes from env vars; NO private key is ever committed.
///   RPC_URL, PRIVATE_KEY (deployer, testnet only in this flow),
///   KEEPER, ROUTER, PRICE_FEED, PENALTY_RECIPIENT, FEE_RECIPIENT,
///   AUTO_SELL_FEE_BPS (default 0)
/// Example (Arc testnet):
///   RPC_URL=$ARC_TESTNET_RPC PRIVATE_KEY=$DEPLOYER_KEY KEEPER=0x... \
///   ROUTER=0x... PRICE_FEED=0x... forge script script/DeployStelixVault.s.sol \
///   --rpc-url $RPC_URL --broadcast --verify
contract DeployStelixVault is Script {
    function run() external returns (StelixVault vault) {
        address keeper = vm.envAddress("KEEPER");
        address router = vm.envAddress("ROUTER");
        address priceFeed = vm.envAddress("PRICE_FEED");
        address penaltyRecipient = vm.envOr("PENALTY_RECIPIENT", address(0));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
        uint16 feeBps = uint16(vm.envOr("AUTO_SELL_FEE_BPS", uint256(0)));

        vm.startBroadcast();
        vault = new StelixVault(
            msg.sender, keeper, router, priceFeed, penaltyRecipient, feeRecipient, feeBps
        );
        vm.stopBroadcast();

        console.log("StelixVault deployed at:", address(vault));
        console.log("chain id:", block.chainid);
        console.log("keeper:", keeper);
        console.log("router:", router);
        console.log("priceFeed:", priceFeed);
        console.log("autoSellFeeBps:", feeBps);
        console.log("NEXT: verify on the explorer, then register the address in");
        console.log("the Chain Manager (admin) before the app points users at it.");
    }
}
