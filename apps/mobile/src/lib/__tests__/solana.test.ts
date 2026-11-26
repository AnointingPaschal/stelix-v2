/**
 * Solana lib tests — derivation cross-checked against an independent
 * hand-rolled SLIP-0010 implementation (node:crypto HMAC + BigInt
 * scalar math; only the final ed25519 base-point step is shared with
 * the lib, via @solana/web3.js Keypair), plus balances/history against
 * a fake Connection (no network). Run: npm test
 */
import * as crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import {
  deriveSolanaAddress,
  fetchSolanaBalances,
  fetchSolanaHistory,
  isValidSolanaAddress,
} from '../solana';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// --- Independent SLIP-0010 (hardened path m/44'/501'/0'/0') -----------------
// NOTE: for ed25519, SLIP-0010 defines the child key as the left half of
// the HMAC output (IL) directly — the "(IL + parent) mod n" addition
// applies to secp256k1 only. The lib under test follows the spec; an
// earlier version of this check added the parent key and was wrong.

function hmacSha512(key: Buffer, data: Buffer): Buffer {
  return crypto.createHmac('sha512', key).update(data).digest();
}

function independentSolanaAddress(mnemonic: string): string {
  const seed = Buffer.from(
    ethers.Mnemonic.fromPhrase(mnemonic).computeSeed().replace(/^0x/, ''),
    'hex',
  );
  let I = hmacSha512(Buffer.from('ed25519 seed', 'utf8'), seed);
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32);
  for (const index of [44 + 0x80000000, 501 + 0x80000000, 0 + 0x80000000, 0 + 0x80000000]) {
    const data = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(key),
      Buffer.from(index.toString(16).padStart(8, '0'), 'hex'),
    ]);
    I = hmacSha512(chainCode, data);
    key = I.subarray(0, 32); // ed25519: child key is IL, no addition
    chainCode = I.subarray(32);
  }
  return Keypair.fromSeed(new Uint8Array(key)).publicKey.toBase58();
}

describe('deriveSolanaAddress', () => {
  it('matches the independent SLIP-0010 derivation', () => {
    expect(deriveSolanaAddress(MNEMONIC)).toBe(independentSolanaAddress(MNEMONIC));
  });

  it('is deterministic and differs per mnemonic', () => {
    expect(deriveSolanaAddress(MNEMONIC)).toBe(deriveSolanaAddress(MNEMONIC));
    expect(deriveSolanaAddress(MNEMONIC)).not.toBe(deriveSolanaAddress(OTHER_MNEMONIC));
    expect(deriveSolanaAddress(OTHER_MNEMONIC)).toBe(independentSolanaAddress(OTHER_MNEMONIC));
  });

  it('produces a valid base58 Solana address', () => {
    expect(isValidSolanaAddress(deriveSolanaAddress(MNEMONIC))).toBe(true);
    expect(isValidSolanaAddress('not-an-address')).toBe(false);
    expect(isValidSolanaAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('throws on an invalid mnemonic', () => {
    expect(() => deriveSolanaAddress('abandon abandon abandon')).toThrow(/Invalid seed phrase/);
  });
});

describe('fetchSolanaBalances (fake Connection)', () => {
  const fakeConnection = {
    getBalance: async () => 1_500_000_000, // 1.5 SOL
    getParsedTokenAccountsByOwner: async () => ({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                  tokenAmount: { amount: '2500000', decimals: 6, uiAmount: 2.5 },
                },
              },
            },
          },
        },
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'So11111111111111111111111111111111111111112',
                  tokenAmount: { amount: '0', decimals: 9, uiAmount: 0 },
                },
              },
            },
          },
        },
      ],
    }),
  };

  it('returns SOL plus parsed SPL tokens, never a placeholder', async () => {
    const res = await fetchSolanaBalances('11111111111111111111111111111111', fakeConnection as never);
    expect(res.sol).toBe(1.5);
    expect(res.lamports).toBe(1_500_000_000);
    expect(res.tokens).toHaveLength(2);
    expect(res.tokens[0]).toMatchObject({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      balance: 2.5,
      balanceRaw: '2500000',
      decimals: 6,
    });
  });
});

describe('fetchSolanaHistory (fake Connection)', () => {
  const addr = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
  const fakeConnection = {
    getSignaturesForAddress: async () => [
      { signature: 'sig1', slot: 100, blockTime: 1700000000, err: null },
      { signature: 'sig2', slot: 99, blockTime: 1699999900, err: null },
      { signature: 'sig3', slot: 98, blockTime: 1699999800, err: null }, // no movement for addr
    ],
    getParsedTransaction: async (signature: string) => {
      if (signature === 'sig1') {
        return {
          meta: {
            preBalances: [1_000_000_000, 5_000_000_000],
            postBalances: [900_000_000, 5_000_000_000],
            preTokenBalances: [],
            postTokenBalances: [],
            fee: 5000,
            err: null,
          },
          transaction: { message: { accountKeys: [addr, 'other'] } },
        };
      }
      if (signature === 'sig2') {
        return {
          meta: {
            preBalances: [900_000_000],
            postBalances: [902_500_000],
            preTokenBalances: [{ owner: addr, mint: 'Mint111', uiTokenAmount: { uiAmount: 10, decimals: 2 } }],
            postTokenBalances: [{ owner: addr, mint: 'Mint111', uiTokenAmount: { uiAmount: 12, decimals: 2 } }],
            fee: 5000,
            err: null,
          },
          transaction: { message: { accountKeys: [addr] } },
        };
      }
      return {
        meta: {
          preBalances: [100],
          postBalances: [100],
          preTokenBalances: [],
          postTokenBalances: [],
          fee: 5000,
          err: null,
        },
        transaction: { message: { accountKeys: ['someone-else'] } },
      };
    },
  };

  it('parses SOL sent and SPL received from pre/post balances', async () => {
    const txs = await fetchSolanaHistory(addr, 25, fakeConnection as never);
    // sig1: -0.1 SOL (sent, fee excluded — 1.0 -> 0.9 SOL is exactly -0.1)
    // sig2: +0.0025 SOL received (fee is paid by the sender here) + 2 tokens
    // sig3: no movement — skipped
    expect(txs.map((t) => t.signature)).toEqual(['sig1', 'sig2']);
    const sent = txs.find((t) => t.signature === 'sig1');
    expect(sent?.solChange).toBeCloseTo(-0.1, 9);
    expect(sent?.failed).toBe(false);
    const received = txs.find((t) => t.signature === 'sig2');
    expect(received?.tokenChanges).toEqual([{ mint: 'Mint111', change: 2, decimals: 2 }]);
  });
});
