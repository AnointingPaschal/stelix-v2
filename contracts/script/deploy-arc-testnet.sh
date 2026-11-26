#!/usr/bin/env bash
# Deploy the Stelix Arc-testnet stack — TESTNET ONLY.
# Order matters: adapters first (vault needs their addresses), then the
# vault, then the launchpad. Nothing here deploys to mainnet.
# Usage (deployer key via env / secret store only — never in this file):
#   RPC_URL=https://rpc.testnet.arc.network \
#   PRIVATE_KEY=$TESTNET_DEPLOYER_KEY \
#   KEEPER=<keeper address> \
#   ./script/deploy-arc-testnet.sh
# The deployer must hold testnet USDC for gas (faucet: https://faucet.circle.com,
# select Arc Testnet). KEEPER must be a dedicated testnet keeper address.
# After deploy: verify each contract on testnet.arcscan.app, then register
# the addresses in the admin Chain Manager (see contracts/DEPLOY_ARC_TESTNET.md).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RPC_URL:?set RPC_URL}"; : "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${KEEPER:?set KEEPER}"
export PATH="$HOME/.foundry/bin:$PATH"

USDC=0x3600000000000000000000000000000000000000
V3_ROUTER=0xfA845604F52843a7b5cfA4030120c6238741F420

echo "== 1/3 adapters (TWAP feed + V3 router adapter)"
USDC=$USDC V3_ROUTER=$V3_ROUTER forge script script/DeployAdapters.s.sol \
  --rpc-url "$RPC_URL" --broadcast --verify

echo "== 2/3 StelixVault (set ROUTER/PRICE_FEED to the adapter addresses above)"
: "${ROUTER:?set ROUTER to the StelixV3RouterAdapter address from step 1}"
: "${PRICE_FEED:?set PRICE_FEED to the UniswapV3TwapFeed address from step 1}"
PENALTY_RECIPIENT=${PENALTY_RECIPIENT:-0x0000000000000000000000000000000000000000} \
FEE_RECIPIENT=${FEE_RECIPIENT:-0x0000000000000000000000000000000000000000} \
AUTO_SELL_FEE_BPS=${AUTO_SELL_FEE_BPS:-0} \
forge script script/DeployStelixVault.s.sol --rpc-url "$RPC_URL" --broadcast --verify

echo "== 3/3 launchpad (factory + fixed-price sale)"
USDC=$USDC forge script script/DeployLaunchpad.s.sol \
  --rpc-url "$RPC_URL" --broadcast --verify

echo "DONE. Verify all four addresses on https://testnet.arcscan.app, then"
echo "register them in D1 (see contracts/DEPLOY_ARC_TESTNET.md)."
