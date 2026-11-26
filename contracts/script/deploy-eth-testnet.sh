#!/usr/bin/env bash
# Deploy StelixVault to eth-testnet — TESTNET ONLY.
# Usage: RPC_URL=... PRIVATE_KEY=... KEEPER=0x... ROUTER=0x... PRICE_FEED=0x... ./deploy-eth-testnet.sh
# Never put a real private key in this file. Use env vars / a secret store.
# After deploy: verify on the explorer, then register the address in the
# admin Chain Manager. Mainnet needs the checklist in contracts/README.md
# (audit of the exact artifact, testnet flow passed, small-value smoke test).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RPC_URL:?set RPC_URL}"; : "${PRIVATE_KEY:?set PRIVATE_KEY}"
: "${KEEPER:?set KEEPER}"; : "${ROUTER:?set ROUTER}"; : "${PRICE_FEED:?set PRICE_FEED}"
export PATH="$HOME/.foundry/bin:$PATH"
forge script script/DeployStelixVault.s.sol --rpc-url "$RPC_URL" --broadcast --verify
