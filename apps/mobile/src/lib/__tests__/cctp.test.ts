/** Circle CCTP V2 bridge — domains, addresses, calldata, attestation polling, fees.
 *  No live network is touched: fetch is mocked and signing is never attempted. */
import { ethers } from 'ethers';
import {
  CCTP_CHAINS,
  CCTP_FINALITY_FAST,
  CCTP_FINALITY_STANDARD,
  CCTP_V2_ADDRESSES,
  addressToBytes32,
  applyBridgeFee,
  buildDepositForBurnCalldata,
  buildReceiveMessageCalldata,
  fetchFastFee,
  getCctpChain,
  isCctpSupported,
  pollAttestation,
  resolveBridgeFee,
  supportedBridgeChains,
} from '../cctp';
import type { ChainConfig } from '../chains';

const RECIPIENT = '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383';
const USDC_ARC = '0x3600000000000000000000000000000000000000';

function chain(over: Partial<ChainConfig>): ChainConfig {
  return {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether',
    nativeDecimals: 18,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    exitStablecoinAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    rpcUrl: 'https://eth.llamarpc.com',
    rpcUrls: ['https://eth.llamarpc.com'],
    explorerUrl: 'https://etherscan.io',
    explorerApiUrl: null,
    dexScreenerChainId: 'ethereum',
    geckoTerminalNetwork: 'eth',
    dex: 'Mainnet aggregator',
    vaultContract: null,
    status: 'live',
    active: true,
    ...over,
  } as ChainConfig;
}

describe('CCTP chain table', () => {
  it('Arc is domain 26 on chain 5042 with the native USDC address', () => {
    const arc = getCctpChain('arc-mainnet');
    expect(arc).toMatchObject({ domain: 26, chainId: 5042, usdcAddress: USDC_ARC });
  });

  it('Ethereum / Base / Polygon / Plasma domains and USDC addresses match Circle docs', () => {
    expect(CCTP_CHAINS.ethereum).toMatchObject({
      domain: 0,
      chainId: 1,
      usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    expect(CCTP_CHAINS.base).toMatchObject({
      domain: 6,
      chainId: 8453,
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    });
    expect(CCTP_CHAINS.polygon).toMatchObject({
      domain: 7,
      chainId: 137,
      usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    });
    expect(CCTP_CHAINS.plasma).toMatchObject({
      domain: 33,
      chainId: 9745,
      usdcAddress: '0x2d661c89d812261039af9764eceaaee884f5f67f',
    });
  });

  it('V2 contract addresses are the deterministic Circle mainnet addresses', () => {
    expect(CCTP_V2_ADDRESSES.tokenMessenger).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
    expect(CCTP_V2_ADDRESSES.messageTransmitter).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64');
    expect(CCTP_V2_ADDRESSES.tokenMinter).toBe('0xfd78EE919681417d192449715b2594ab58f5D002');
  });

  it('BNB is excluded (no CCTP USDC) and unknown chains are unsupported', () => {
    expect(isCctpSupported('bnb')).toBe(false);
    expect(isCctpSupported('solana')).toBe(false);
    expect(isCctpSupported('nope')).toBe(false);
    expect(getCctpChain('bnb')).toBeNull();
  });
});

describe('supportedBridgeChains', () => {
  it('intersects served chains with Circle-verified chains, mainnet EVM only', () => {
    const served = [
      chain({ id: 'ethereum' }),
      chain({ id: 'base', name: 'Base', chainId: 8453 }),
      chain({ id: 'bnb', name: 'BNB Chain', chainId: 56 }),
      chain({ id: 'solana', name: 'Solana', chainId: null, kind: 'solana' }),
      chain({ id: 'ethereum-sepolia', name: 'Ethereum Sepolia', chainId: 11155111, testnet: true }),
      chain({ id: 'plasma', name: 'Plasma', chainId: 9745, comingSoon: true }),
      chain({ id: 'arc-mainnet', name: 'Arc Mainnet', chainId: 5042 }),
    ];
    const ids = supportedBridgeChains(served).map((c) => c.id);
    // BNB (no CCTP USDC), Solana (non-EVM), Sepolia (not mainnet) and
    // coming-soon Plasma are all excluded.
    expect(ids).toEqual(['ethereum', 'base', 'arc-mainnet']);
  });
});

describe('calldata builders', () => {
  it('depositForBurn encodes amount, domain, recipient, token, fee and finality', () => {
    const data = buildDepositForBurnCalldata({
      amountRaw: 1000000n,
      destinationDomain: 6,
      mintRecipient: RECIPIENT,
      burnToken: USDC_ARC,
      maxFee: 0n,
      minFinalityThreshold: CCTP_FINALITY_STANDARD,
    });
    const iface = new ethers.Interface([
      'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)',
    ]);
    const decoded = iface.decodeFunctionData('depositForBurn', data);
    expect(decoded.amount).toBe(1000000n);
    expect(decoded.destinationDomain).toBe(6n);
    expect(decoded.mintRecipient).toBe(addressToBytes32(RECIPIENT));
    expect(decoded.burnToken.toLowerCase()).toBe(USDC_ARC.toLowerCase());
    expect(decoded.destinationCaller).toBe(ethers.ZeroHash);
    expect(decoded.maxFee).toBe(0n);
    expect(decoded.minFinalityThreshold).toBe(BigInt(CCTP_FINALITY_STANDARD));
    expect(CCTP_FINALITY_FAST).toBeLessThanOrEqual(1000);
    expect(CCTP_FINALITY_STANDARD).toBeGreaterThanOrEqual(2000);
  });

  it('receiveMessage encodes message + attestation', () => {
    const message = `0x${'11'.repeat(64)}`;
    const attestation = `0x${'22'.repeat(65)}`;
    const data = buildReceiveMessageCalldata(message, attestation);
    const iface = new ethers.Interface([
      'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
    ]);
    const decoded = iface.decodeFunctionData('receiveMessage', data);
    expect(decoded.message).toBe(message);
    expect(decoded.attestation).toBe(attestation);
  });

  it('addressToBytes32 zero-pads an address and rejects garbage', () => {
    expect(addressToBytes32(RECIPIENT)).toBe(`0x000000000000000000000000${RECIPIENT.slice(2).toLowerCase()}`);
    expect(() => addressToBytes32('not-an-address')).toThrow();
  });
});

describe('pollAttestation', () => {
  const message = `0x${'aa'.repeat(32)}`;
  const attestation = `0x${'bb'.repeat(65)}`;

  it('returns message + attestation once Iris reports complete', async () => {
    let calledUrl = '';
    const fetchFn = jest.fn(async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ message, attestation, status: 'complete' }] }),
      };
    });
    const res = await pollAttestation({ sourceDomain: 26, txHash: '0xabc', fetchFn, pollIntervalMs: 10 });
    expect(res).toEqual({ message, attestation, status: 'complete' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(calledUrl).toContain('/v2/messages/26?transactionHash=0xabc');
  });

  it('treats pending / 404 as "keep waiting", then completes', async () => {
    let calls = 0;
    const fetchFn = jest.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 404, json: async () => ({}) };
      if (calls === 2) return { ok: true, status: 200, json: async () => ({ messages: [{ status: 'pending' }] }) };
      return { ok: true, status: 200, json: async () => ({ messages: [{ message, attestation, status: 'complete' }] }) };
    });
    const res = await pollAttestation({ sourceDomain: 0, txHash: '0xdef', fetchFn, pollIntervalMs: 10 });
    expect(res.message).toBe(message);
    expect(calls).toBe(3);
  });

  it('times out with a message that keeps the burn hash usable', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ status: 'pending' }] }),
    }));
    await expect(
      pollAttestation({ sourceDomain: 0, txHash: '0x123', fetchFn, pollIntervalMs: 10, timeoutMs: 25 }),
    ).rejects.toThrow(/burned on the source chain/);
  });
});

describe('fetchFastFee', () => {
  it('returns the matching route entry and null for unknown routes / failures', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fees: [
          { sourceDomain: 0, destinationDomain: 6, minimumFee: '10', maximumFee: '500' },
          { sourceDomain: 6, destinationDomain: 0, minimumFee: '5', maximumFee: '250' },
        ],
      }),
    }));
    const fee = await fetchFastFee({ sourceDomain: 0, destinationDomain: 6, fetchFn });
    expect(fee).toEqual({ sourceDomain: 0, destinationDomain: 6, minFee: 10n, maxFee: 500n });
    expect(await fetchFastFee({ sourceDomain: 0, destinationDomain: 7, fetchFn })).toBeNull();
    const failing = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await fetchFastFee({ sourceDomain: 0, destinationDomain: 6, fetchFn: failing })).toBeNull();
  });
});

describe('resolveBridgeFee / applyBridgeFee', () => {
  it('no fee config means no fee is invented', () => {
    expect(resolveBridgeFee(null)).toEqual({ recipient: null, feeBps: 0 });
    expect(resolveBridgeFee({ fees: {} })).toEqual({ recipient: null, feeBps: 0 });
    expect(resolveBridgeFee(undefined)).toEqual({ recipient: null, feeBps: 0 });
  });

  it('reads feeRecipient + bridgeFeeBps defensively and rejects bad values', () => {
    expect(
      resolveBridgeFee({ fees: { feeRecipient: RECIPIENT, bridgeFeeBps: 25 } }),
    ).toEqual({ recipient: RECIPIENT, feeBps: 25 });
    // Fee without a valid recipient cannot be collected: no fee.
    expect(resolveBridgeFee({ fees: { feeRecipient: 'not-an-address', bridgeFeeBps: 25 } })).toEqual({
      recipient: null,
      feeBps: 25,
    });
    // Out-of-range bps is clamped, never applied blindly.
    expect(resolveBridgeFee({ fees: { feeRecipient: RECIPIENT, bridgeFeeBps: 99999 } }).feeBps).toBe(10000);
  });

  it('splits the burn amount from the fee amount', () => {
    expect(applyBridgeFee(1000000n, 0)).toEqual({ burnAmount: 1000000n, feeAmount: 0n });
    expect(applyBridgeFee(1000000n, 25)).toEqual({ burnAmount: 997500n, feeAmount: 2500n });
  });
});
