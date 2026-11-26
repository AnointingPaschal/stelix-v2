/** History dust/spam filter. */
import { filterHistory, isDustOrSpam, type TxRecord } from '../history';

function tx(over: Partial<TxRecord> = {}): TxRecord {
  return {
    id: '0x1', hash: '0x1', kind: 'received', token: 'USDT', amount: 10, amountRaw: '10000000',
    usd: 10, at: Date.now(), status: 'confirmed', isSpam: false, chainId: 'bnb', blockNumber: 1, ...over,
  };
}

describe('dust / spam filter', () => {
  it('flags zero-value transfers as dust', () => {
    expect(isDustOrSpam(tx({ amount: 0, usd: 0 }))).toBe(true);
  });

  it('flags unsolicited airdrop-style tokens with no value', () => {
    expect(isDustOrSpam(tx({ token: 'FREE$$', amount: 1000000, usd: 0 }))).toBe(true);
    expect(isDustOrSpam(tx({ token: 'Visit free-money.com', amount: 5, usd: null }))).toBe(true);
  });

  it('does not flag a real USDT receipt', () => {
    expect(isDustOrSpam(tx())).toBe(false);
  });

  it('filterHistory hides spam by default and shows it with showDust', () => {
    const list = [tx(), tx({ id: '0x2', hash: '0x2', token: 'FREE$$', amount: 0, usd: 0, isSpam: true })];
    expect(filterHistory(list)).toHaveLength(1);
    expect(filterHistory(list, { showDust: true })).toHaveLength(2);
  });
});
