/** History dust/spam filter + keyless Blockscout history for Arc. */
import { EXPLORER_API_KEY_STORAGE_KEY, fetchHistory, fetchRpcLogHistory, filterHistory, getExplorerApiKeyAsync, isDustOrSpam, type TxRecord } from '../history';
import { kvDelete, kvSet } from '../storage';

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

describe('getExplorerApiKeyAsync (env wins, then key saved in Settings)', () => {
  const realFetch = global.fetch;
  const originalEnv = process.env.EXPO_PUBLIC_EXPLORER_API_KEY;

  afterEach(async () => {
    global.fetch = realFetch;
    await kvDelete(EXPLORER_API_KEY_STORAGE_KEY);
    if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    else process.env.EXPO_PUBLIC_EXPLORER_API_KEY = originalEnv;
  });

  it('returns null when neither the env key nor a stored key exists', async () => {
    delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    await expect(getExplorerApiKeyAsync()).resolves.toBeNull();
  });

  it('returns the key saved on-device in Settings', async () => {
    delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    await kvSet(EXPLORER_API_KEY_STORAGE_KEY, 'stored-key-123');
    await expect(getExplorerApiKeyAsync()).resolves.toBe('stored-key-123');
  });

  it('prefers the env key over a stored key', async () => {
    process.env.EXPO_PUBLIC_EXPLORER_API_KEY = 'env-key';
    await kvSet(EXPLORER_API_KEY_STORAGE_KEY, 'stored-key-123');
    await expect(getExplorerApiKeyAsync()).resolves.toBe('env-key');
  });

  it('a stored key unlocks BNB history (Etherscan v2) with no env key', async () => {
    delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    await kvSet(EXPLORER_API_KEY_STORAGE_KEY, 'stored-key-123');
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
    global.fetch = jest.fn(async (url: string) => {
      expect(url).toContain('apikey=stored-key-123');
      expect(url).toContain('chainid=56');
      return ok({
        status: '1',
        result: [
          {
            hash: '0xbnb1',
            from: OTHER,
            to: ME,
            value: '1000000000000000000',
            tokenSymbol: 'BNB',
            tokenDecimal: '18',
            timeStamp: '1793116800',
            blockNumber: '123',
            isError: '0',
          },
        ],
      });
    }) as unknown as typeof fetch;
    const res = await fetchHistory('bnb', ME);
    expect(res.status).toBe('ok');
    expect(res.txs).toHaveLength(1);
    expect(res.txs[0].token).toBe('BNB');
    expect(res.txs[0].amount).toBe(1);
  });

  it('without any key, BNB history works keyless via the RPC Transfer-log scan (never invented txs)', async () => {
    delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    // NOTE: the shared ME constant above is 44 chars (not a valid
    // 20-byte address); log topics are 32-byte words, so this test
    // uses a valid 40-hex-char address for the topic math.
    const ME2 = '0xfb1aaa0000000000000000000000000000007b0b';
    const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
    const usdt = '0x55d398326f99059fF775485246999027B3197955';
    // ABI-encoded symbol() -> "USDT", decimals() -> 18.
    const abiString = (s: string) => {
      const data = Buffer.from(s, 'utf8').toString('hex');
      return `0x${'0'.repeat(62)}20${'0'.repeat(62)}${s.length.toString(16).padStart(2, '0')}${data}${'0'.repeat((32 - s.length) * 2)}`;
    };
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
    global.fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: unknown[] };
      if (body.method === 'eth_blockNumber') return ok({ jsonrpc: '2.0', id: 1, result: '0x100000' });
      if (body.method === 'eth_getLogs') {
        return ok({
          jsonrpc: '2.0',
          id: 1,
          result: [
            {
              address: usdt,
              blockNumber: '0xffff0',
              data: '0x4563918244f40000', // 5 USDT (18 dec)
              transactionHash: '0xbnb-log1',
              logIndex: '0x0',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                pad(OTHER),
                pad(ME2),
              ],
            },
          ],
        });
      }
      if (body.method === 'eth_call') {
        const data = (body.params as { data?: string }[] | undefined)?.[0]?.data ?? '';
        if (data.startsWith('0x95d89b41')) return ok({ jsonrpc: '2.0', id: 1, result: abiString('USDT') });
        if (data.startsWith('0x313ce567')) return ok({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(62)}12` });
      }
      if (body.method === 'eth_getBlockByNumber') {
        return ok({ jsonrpc: '2.0', id: 1, result: { timestamp: '0x69000000' } });
      }
      throw new Error(`unexpected RPC call: ${body.method}`);
    }) as unknown as typeof fetch;
    const res = await fetchHistory('bnb', ME2);
    expect(res.status).toBe('ok');
    expect(res.error).toBeNull();
    expect(res.txs).toHaveLength(1);
    expect(res.txs[0].token).toBe('USDT');
    expect(res.txs[0].amount).toBe(5);
    expect(res.txs[0].kind).toBe('received');
    expect(res.txs[0].counterparty).toBe(OTHER);
  });

  it('when the public RPC refuses log queries, BNB history reports error — never a key request', async () => {
    delete process.env.EXPO_PUBLIC_EXPLORER_API_KEY;
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
    global.fetch = jest.fn(async () => {
      return ok({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'limit exceeded' } });
    }) as unknown as typeof fetch;
    const res = await fetchHistory('bnb', ME);
    expect(res.status).toBe('error');
    expect(res.txs).toHaveLength(0);
    expect(res.error ?? '').not.toMatch(/api key/i);
  });
});

describe('keyless Blockscout history (Ethereum)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('shows a token receive on Ethereum with no explorer key', async () => {
    mockBlockscout();
    const res = await fetchHistory('ethereum', ME);
    expect(res.status).toBe('ok');
    expect(res.error).toBeNull();
    expect(res.txs).toHaveLength(1);
    expect(res.txs[0].token).toBe('USDC');
    expect(res.txs[0].amount).toBe(30);
  });
});

describe('fetchRpcLogHistory decoding', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('ignores logs where the wallet is neither sender nor receiver', async () => {
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
    global.fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
      if (body.method === 'eth_blockNumber') return ok({ jsonrpc: '2.0', id: 1, result: '0x100' });
      if (body.method === 'eth_getLogs') return ok({ jsonrpc: '2.0', id: 1, result: [] });
      throw new Error(`unexpected RPC call: ${body.method}`);
    }) as unknown as typeof fetch;
    const { getChain } = await import('../chains');
    const txs = await fetchRpcLogHistory(getChain('bnb'), ME);
    expect(txs).toHaveLength(0);
  });
});

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
