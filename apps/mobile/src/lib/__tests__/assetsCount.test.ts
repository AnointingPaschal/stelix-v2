/** Home "Assets N tokens" count — it must equal the rows actually listed.
 *  Regression test for the bug where 0-balance default/imported rows (BNB,
 *  WKC) were listed but the count filtered to balance > 0, showing 0. */
import { visibleTokens } from '../balances';

function token(symbol: string, balance: number, isSpam: boolean) {
  return { symbol, balance, locked: 0, isSpam };
}

describe('visibleTokens / assets count', () => {
  it('counts 0-balance listed rows: BNB + WKC listed means Assets 2, not 0', () => {
    const tokens = [token('BNB', 0, false), token('WKC', 0, false)];
    const visible = visibleTokens(tokens, false);
    expect(visible).toHaveLength(2);
    expect(visible.length).toBe(2); // assetCount = visible.length
  });

  it('hides spam by default and shows it when toggled', () => {
    const tokens = [token('BNB', 0, false), token('SCAM', 100, true)];
    expect(visibleTokens(tokens, false)).toHaveLength(1);
    expect(visibleTokens(tokens, true)).toHaveLength(2);
  });

  it('counts locked-only and nonzero rows the same as listed rows', () => {
    const tokens = [token('BNB', 0, false), { ...token('WKC', 0, false), locked: 5 }];
    expect(visibleTokens(tokens, false)).toHaveLength(2);
  });
});
