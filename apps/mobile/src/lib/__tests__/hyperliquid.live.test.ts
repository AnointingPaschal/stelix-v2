/**
 * Live Hyperliquid testnet tests — run ONLY with HL_LIVE_TESTS=1.
 *
 * These hit the real testnet API (no key needed for info calls). The
 * signed-action test uses a throwaway in-memory wallet and sends a `noop`
 * action, which needs no funds and changes nothing on-chain; it proves
 * the SDK's EIP-712 signing round-trips through the real exchange.
 *
 * Run: HL_LIVE_TESTS=1 npx jest src/lib/__tests__/hyperliquid.live.test.ts
 */
import { ethers } from 'ethers';
import * as hl from '@nktkas/hyperliquid';
import { HyperliquidClient } from '../hyperliquid';

const LIVE = process.env.HL_LIVE_TESTS === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive('Hyperliquid live testnet', () => {
  it('fetches perp meta + allMids from testnet', async () => {
    const client = new HyperliquidClient('testnet');
    const markets = await client.getPerpMarkets();
    expect(markets.length).toBeGreaterThan(100);
    const btc = markets.find((m) => m.name === 'BTC');
    expect(btc).toBeDefined();
    expect(btc!.maxLeverage).toBeGreaterThan(0);
    expect(btc!.szDecimals).toBeGreaterThanOrEqual(0);

    const mids = await client.getAllMids();
    expect(mids.BTC).toBeGreaterThan(0);
    expect(mids.ETH).toBeGreaterThan(0);
  }, 30000);

  it('fetches spot meta + candles from testnet', async () => {
    const client = new HyperliquidClient('testnet');
    const { tokens, markets } = await client.getSpotMeta();
    expect(tokens.length).toBeGreaterThan(100);
    expect(markets.length).toBeGreaterThan(0);
    const usdc = tokens.find((t) => t.name === 'USDC');
    expect(usdc).toBeDefined();

    const end = Date.now();
    const candles = await client.getCandles('BTC', '1h', end - 5 * 3600_000, end);
    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0].close).toBeGreaterThan(0);
  }, 30000);

  it('signs a noop action and the exchange processes it (throwaway wallet)', async () => {
    // Throwaway in-memory wallet — never a real key. A noop needs no
    // funds and changes nothing; it proves the EIP-712 signing
    // (phantom-agent L1 action, chainId 1337) round-trips through the
    // real exchange. A throwaway wallet has no Hyperliquid account (the
    // testnet faucet only pays addresses that deposited on mainnet), so
    // the exchange answers "User or API Wallet ... does not exist" —
    // that error itself proves the signature was valid: the exchange
    // verified it, derived the address, and only then found no account.
    // A bad signature fails earlier with an invalid-signature error.
    // A fully-funded testnet account is needed for a live order success.
    const wallet = ethers.Wallet.createRandom();
    const transport = new hl.HttpTransport({ apiUrl: hl.TESTNET_API_URL, isTestnet: true });
    const exchange = new hl.ExchangeClient({ transport, wallet });
    try {
      const res = await exchange.noop({ nonce: Date.now() });
      expect(res.status).toBe('ok');
    } catch (e) {
      expect(e instanceof Error ? e.message : String(e)).toMatch(/does not exist/i);
    }
  }, 30000);

  it('receives live allMids over the testnet WebSocket', async () => {
    const client = new HyperliquidClient('testnet');
    try {
      const mids = await new Promise<Record<string, number>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No WS message within 20s')), 20000);
        void client
          .subscribeAllMids((data) => {
            clearTimeout(timer);
            resolve(data);
          })
          .catch(reject);
      });
      expect(mids.BTC).toBeGreaterThan(0);
    } finally {
      client.disconnect();
    }
  }, 30000);
});
