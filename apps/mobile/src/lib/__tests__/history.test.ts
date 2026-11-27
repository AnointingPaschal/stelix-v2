/** History dust/spam filter + keyless Blockscout history for Arc. */
import { fetchHistory, filterHistory, isDustOrSpam, type TxRecord } from '../history';

const ME = '0xfb1aaa0000000000000000000000000000007b0b2b';
const OTHER = '0x1111111111111111111111111111111111111111';

function mockBlockscout() {
  const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes('/token-transfers')) {
      return ok({
        items: [
          {
            block_number: 123456,
            from: { hash: OTHER },
            to: { hash: ME },
            timestamp: '2026-11-27T12:47:00.000000Z',
            token: { symbol: 'USDC', decimals: '6', name: 'USD Coin' },
            total: { value: '30000000' },
            transaction_hash: '0xabc123',
          },
        ],
      });
    }
    if (url.includes('/transactions')) {
      return ok({
        items: [
          {
            hash: '0xabc123',
            block_number: 123456,
            from: { hash: OTHER },
            to: { hash: ME },
            value: '30000000000000000000',
            timestamp: '2026-11-27T12:47:00.000000Z',
            status: 'ok',
          },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe('Blockscout history (Arc, no API key)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('shows a 30 USDC receive on Arc Testnet with no explorer key', async () => {
    mockBlockscout();
    const res = await fetchHistory('arc', ME);
    expect(res.status).toBe('ok');
    expect(res.error).toBeNull();
    // One record, not two: the same tx appears as both a token
    // transfer and a native transaction on Arc, and is kept once.
    expect(res.txs).toHaveLength(1);
    expect(res.txs[0].kind).toBe('received');
    expect(res.txs[0].token).toBe('USDC');
    expect(res.txs[0].amount).toBe(30);
    expect(res.txs[0].counterparty).toBe(OTHER);
  });
});

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
