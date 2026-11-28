/**
 * Import screen helpers: search-mode detection (address vs name/symbol)
 * and the hidden-token set behind the Activate toggles — a token
 * toggled OFF must stay off across refreshes, and toggling it back ON
 * must clear the hidden record.
 */
import {
  detectImportSearchMode,
  hiddenTokenKey,
  hideToken,
  isPartialContractAddress,
  isTokenHidden,
  loadHiddenTokens,
  parseHiddenSet,
  setTokenVisibility,
  unhideToken,
  type ToggleTokenDeps,
} from '../importToken';
import { mergeDiscoveredTokens, type DiscoveredToken, type ImportedToken } from '../balances';

const WALLET = '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383';
const OTHER_WALLET = '0x0000000000000000000000000000000000000001';
const TOKEN = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC

describe('detectImportSearchMode', () => {
  it('detects a full contract address', () => {
    expect(detectImportSearchMode(TOKEN)).toBe('address');
    expect(detectImportSearchMode(`  ${TOKEN.toLowerCase()}  `)).toBe('address');
  });

  it('treats blank input as empty', () => {
    expect(detectImportSearchMode('')).toBe('empty');
    expect(detectImportSearchMode('   ')).toBe('empty');
  });

  it('treats names, symbols and partial addresses as a name search', () => {
    expect(detectImportSearchMode('usdc')).toBe('search');
    expect(detectImportSearchMode('Pancake')).toBe('search');
    expect(detectImportSearchMode('0x1234')).toBe('search');
    expect(detectImportSearchMode('not an address')).toBe('search');
  });
});

describe('isPartialContractAddress', () => {
  it('flags a half-typed address, not a name or a full address', () => {
    expect(isPartialContractAddress('0x')).toBe(false);
    expect(isPartialContractAddress('0x55d3')).toBe(true);
    expect(isPartialContractAddress(TOKEN)).toBe(false);
    expect(isPartialContractAddress('usdc')).toBe(false);
  });
});

describe('hidden set (parse + storage)', () => {
  it('parses a stored array, and malformed storage as empty', () => {
    const set = parseHiddenSet(JSON.stringify(['bnb:0xabc', 'arc:0xdef']));
    expect(set.has('bnb:0xabc')).toBe(true);
    expect(parseHiddenSet(null).size).toBe(0);
    expect(parseHiddenSet('not json').size).toBe(0);
    expect(parseHiddenSet('{"a":1}').size).toBe(0);
  });

  it('keys are chain-scoped and case-insensitive on the address', () => {
    expect(hiddenTokenKey('bnb', TOKEN)).toBe(`bnb:${TOKEN.toLowerCase()}`);
    expect(hiddenTokenKey('bnb', TOKEN)).not.toBe(hiddenTokenKey('arc', TOKEN));
  });

  it('hide / unhide round-trips per wallet and never leaks across wallets', async () => {
    expect(await loadHiddenTokens(WALLET)).toEqual(new Set());
    await hideToken('bnb', TOKEN, WALLET);
    const hidden = await loadHiddenTokens(WALLET);
    expect(isTokenHidden(hidden, 'bnb', TOKEN)).toBe(true);
    expect(isTokenHidden(hidden, 'bnb', TOKEN.toLowerCase())).toBe(true);
    expect(isTokenHidden(hidden, 'arc', TOKEN)).toBe(false);
    // Another wallet's set is untouched.
    expect(await loadHiddenTokens(OTHER_WALLET)).toEqual(new Set());
    await unhideToken('bnb', TOKEN, WALLET);
    expect(await loadHiddenTokens(WALLET)).toEqual(new Set());
  });
});

describe('setTokenVisibility', () => {
  function deps(): { deps: ToggleTokenDeps; add: jest.Mock; remove: jest.Mock } {
    const add = jest.fn().mockResolvedValue([]);
    const remove = jest.fn().mockResolvedValue([]);
    return { deps: { addImportedToken: add, removeImportedToken: remove }, add, remove };
  }

  const token: ImportedToken = {
    chainId: 'bnb',
    address: TOKEN,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
  };

  it('ON adds the token and clears any hidden record', async () => {
    const { deps: d, add } = deps();
    await hideToken('bnb', TOKEN, WALLET); // previously hidden
    await setTokenVisibility({
      chainId: 'bnb',
      address: TOKEN,
      token,
      visible: true,
      ownerAddress: WALLET,
      deps: d,
    });
    expect(add).toHaveBeenCalledWith(token, WALLET);
    expect(await loadHiddenTokens(WALLET)).toEqual(new Set());
  });

  it('OFF removes the token and records it hidden', async () => {
    const { deps: d, remove } = deps();
    await setTokenVisibility({
      chainId: 'bnb',
      address: TOKEN,
      token: null,
      visible: false,
      ownerAddress: WALLET,
      deps: d,
    });
    expect(remove).toHaveBeenCalledWith('bnb', TOKEN, WALLET);
    expect(isTokenHidden(await loadHiddenTokens(WALLET), 'bnb', TOKEN)).toBe(true);
  });

  it('ON without token details throws instead of saving a broken row', async () => {
    const { deps: d, add } = deps();
    await expect(
      setTokenVisibility({ chainId: 'bnb', address: TOKEN, token: null, visible: true, ownerAddress: WALLET, deps: d }),
    ).rejects.toThrow('Token details are needed');
    expect(add).not.toHaveBeenCalled();
  });
});

describe('hidden set vs discovery (the balances.ts hook, pure level)', () => {
  it('a hidden discovered token is skipped and never reappears', async () => {
    await hideToken('bnb', TOKEN, WALLET);
    const hidden = await loadHiddenTokens(WALLET);
    const discovered: DiscoveredToken[] = [
      { chainId: 'bnb', address: TOKEN, symbol: 'USDT', name: 'Tether USD', decimals: 18 },
      { chainId: 'bnb', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
    ];
    // This is exactly the filter fetchBalances applies before
    // mergeDiscoveredTokens — the hidden row drops, the other stays.
    const visible = discovered.filter((d) => !isTokenHidden(hidden, d.chainId, d.address));
    const merged = mergeDiscoveredTokens([], visible, 'bnb');
    expect(merged.map((t) => t.symbol)).toEqual(['USDC']);
    expect(merged.every((t) => !isTokenHidden(hidden, t.chainId, t.address))).toBe(true);
  });
});
