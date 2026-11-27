/**
 * Arc imported-token migration (2026-11-27): while the picker collapsed
 * Arc Testnet and Arc Mainnet into one 'arc' entry, every Arc import was
 * saved with chainId 'arc' — testnet tokens and mainnet tokens alike.
 * Now that the two networks are separate entries, migrateArcImportedTokens
 * re-checks those rows against both Arc RPCs (mocked here) and moves
 * mainnet-only tokens to 'arc-mainnet', duplicates tokens that exist on
 * both networks, and leaves testnet-only / unknown tokens on 'arc'.
 */
import { getChain } from '../chains';
import {
  loadImportedTokens,
  migrateArcImportedTokens,
  saveImportedTokens,
  type GetCodeFn,
  type ImportedToken,
} from '../balances';

const STX = '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7';
const BSCT = '0x6AD77e153f6D4Dd7c0F2e194A385e625274dE794';
const BOTH = '0x1111111111111111111111111111111111111111';
const NEITHER = '0x2222222222222222222222222222222222222222';

const TESTNET_RPC = getChain('arc').rpcUrl;
const MAINNET_RPC = getChain('arc-mainnet').rpcUrl;

function token(address: string, symbol: string): ImportedToken {
  return { chainId: 'arc', address, symbol, name: symbol, decimals: 18 };
}

/** Mock getCode: STX on mainnet only, BSCT on testnet only, BOTH on
 *  both, NEITHER on neither. */
const mockGetCode: GetCodeFn = async (rpcUrl, address) => {
  const a = address.toLowerCase();
  const onTestnet = a === BSCT.toLowerCase() || a === BOTH.toLowerCase();
  const onMainnet = a === STX.toLowerCase() || a === BOTH.toLowerCase();
  if (rpcUrl === TESTNET_RPC) return onTestnet ? '0x6080604052' : '0x';
  if (rpcUrl === MAINNET_RPC) return onMainnet ? '0x6080604052' : '0x';
  throw new Error(`unexpected rpc url ${rpcUrl}`);
};

describe('migrateArcImportedTokens', () => {
  it('moves a mainnet-only token (STX) from arc to arc-mainnet', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a01';
    await saveImportedTokens([token(STX, 'STX'), token(BSCT, 'BSCT')], owner);
    await migrateArcImportedTokens(owner, mockGetCode);
    const list = await loadImportedTokens(owner);
    expect(list.find((t) => t.symbol === 'STX')?.chainId).toBe('arc-mainnet');
    expect(list.find((t) => t.symbol === 'BSCT')?.chainId).toBe('arc');
  });

  it('keeps a testnet-only token on arc and a token on neither network on arc', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a02';
    await saveImportedTokens([token(BSCT, 'BSCT'), token(NEITHER, 'XXX')], owner);
    await migrateArcImportedTokens(owner, mockGetCode);
    const list = await loadImportedTokens(owner);
    expect(list).toHaveLength(2);
    expect(list.every((t) => t.chainId === 'arc')).toBe(true);
  });

  it('lists a token that exists on both networks on both', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a03';
    await saveImportedTokens([token(BOTH, 'BOTH')], owner);
    await migrateArcImportedTokens(owner, mockGetCode);
    const list = await loadImportedTokens(owner);
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.chainId).sort()).toEqual(['arc', 'arc-mainnet']);
  });

  it('is a no-op on the second run (flag set) even if the RPC answers change', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a04';
    await saveImportedTokens([token(STX, 'STX')], owner);
    await migrateArcImportedTokens(owner, mockGetCode);
    expect((await loadImportedTokens(owner))[0]?.chainId).toBe('arc-mainnet');
    // A getCode that would now claim STX is testnet-only must not move it back.
    const flipped: GetCodeFn = async (rpcUrl) =>
      rpcUrl === TESTNET_RPC ? '0x6080604052' : '0x';
    await migrateArcImportedTokens(owner, flipped);
    expect((await loadImportedTokens(owner))[0]?.chainId).toBe('arc-mainnet');
  });

  it('leaves the list unchanged and retries later when the RPC check fails', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a05';
    await saveImportedTokens([token(STX, 'STX')], owner);
    const failing: GetCodeFn = async () => {
      throw new Error('rpc down');
    };
    await migrateArcImportedTokens(owner, failing);
    expect((await loadImportedTokens(owner))[0]?.chainId).toBe('arc');
    // Retry with a working RPC: the migration now applies.
    await migrateArcImportedTokens(owner, mockGetCode);
    expect((await loadImportedTokens(owner))[0]?.chainId).toBe('arc-mainnet');
  });

  it('does nothing (and sets the flag) when there are no legacy arc rows', async () => {
    const owner = '0xC69b60a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a06';
    await saveImportedTokens(
      [{ ...token(STX, 'STX'), chainId: 'arc-mainnet' }],
      owner,
    );
    await migrateArcImportedTokens(owner, mockGetCode);
    const list = await loadImportedTokens(owner);
    expect(list).toHaveLength(1);
    expect(list[0]?.chainId).toBe('arc-mainnet');
  });
});
