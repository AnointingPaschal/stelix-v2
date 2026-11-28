/** History dust/spam filter + keyless Blockscout history for Arc. */
import * as fs from 'fs';
import * as path from 'path';
import { EXPLORER_API_KEY_STORAGE_KEY, fetchHistory, fetchRpcLogHistory, filterHistory, getExplorerApiKeyAsync, historyRowStatus, isDustOrSpam, localTxToTxRecord, mergeHistoryTxs, type TxRecord } from '../history';
import { clearAllLocalHistory, recordLocalTx, type LocalTxRecord, type NewLocalTx } from '../localHistory';
import { kvDelete, kvSet } from '../storage';

// The kv store is shared across tests in this file (in-memory map in
// Jest): every test starts from an empty local ledger, so fetchHistory
// merge tests never leak records into the older on-chain-only tests.
beforeEach(async () => {
  await clearAllLocalHistory();
});

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

  it('shows a 30 USDC receive on Arc Mainnet with no explorer key', async () => {
    mockBlockscout();
    const res = await fetchHistory('arc-mainnet', ME);
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

/* ------------------------------------------------------------------ */
/* Phase B — local-ledger merge.                                      */
/* ------------------------------------------------------------------ */

const NOW_B = 1_800_000_000_000;

function localRec(over: Partial<LocalTxRecord> & { hash: string }): LocalTxRecord {
  return {
    chain: 'arc-mainnet',
    wallet: ME.toLowerCase(),
    type: 'send',
    tokenSymbol: 'USDC',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    amount: '30',
    amountRaw: '30000000',
    from: ME.toLowerCase(),
    to: OTHER,
    timestamp: NOW_B,
    status: 'pending',
    blockNumber: null,
    ...over,
  };
}

function newLocalTx(over: Partial<NewLocalTx> & { hash: string }): NewLocalTx {
  const { status, blockNumber, ...rest } = localRec(over);
  return { ...rest, status: over.status, blockNumber: over.blockNumber };
}

describe('localTxToTxRecord', () => {
  it('maps a pending send to a pending sent row with the human amount', () => {
    const rec = localTxToTxRecord(localRec({ hash: '0xaaa1', amount: '12.5', amountRaw: '12500000' }));
    expect(rec).toMatchObject({
      id: '0xaaa1',
      hash: '0xaaa1',
      kind: 'sent',
      token: 'USDC',
      amount: 12.5,
      amountRaw: '12500000',
      status: 'pending',
      isSpam: false,
      chainId: 'arc-mainnet',
      blockNumber: null,
    });
    expect(rec.counterparty).toBe(OTHER);
  });

  it('maps every local type to its History kind', () => {
    const kinds: [LocalTxRecord['type'], TxRecord['kind']][] = [
      ['send', 'sent'],
      ['swap', 'swap'],
      ['lock', 'lock'],
      ['unlock', 'unlock'],
      ['break', 'break'],
      ['claim', 'claim'],
      ['approve', 'approve'],
      ['other', 'other'],
    ];
    for (const [type, kind] of kinds) {
      expect(localTxToTxRecord(localRec({ hash: `0x${type}`, type })).kind).toBe(kind);
    }
  });

  it('carries failed and unknown statuses through unchanged', () => {
    expect(localTxToTxRecord(localRec({ hash: '0xf1', status: 'failed', blockNumber: 42 })).status).toBe('failed');
    expect(localTxToTxRecord(localRec({ hash: '0xf1', status: 'failed', blockNumber: 42 })).blockNumber).toBe(42);
    expect(localTxToTxRecord(localRec({ hash: '0xu1', status: 'unknown' })).status).toBe('unknown');
    expect(localTxToTxRecord(localRec({ hash: '0xc1', status: 'confirmed', blockNumber: 7 })).status).toBe('confirmed');
  });
});

describe('mergeHistoryTxs', () => {
  it('a hash in both sources appears once, with the local record winning', () => {
    const onChain = tx({ id: '0xabc123', hash: '0xABC123', kind: 'received', amount: 30, status: 'confirmed', at: NOW_B });
    const merged = mergeHistoryTxs([localRec({ hash: '0xabc123', amount: '5', status: 'pending', timestamp: NOW_B + 1000 })], [onChain]);
    expect(merged).toHaveLength(1);
    expect(merged[0].hash).toBe('0xabc123');
    // Local wins: its kind/amount/status, not the on-chain row's.
    expect(merged[0].kind).toBe('sent');
    expect(merged[0].amount).toBe(5);
    expect(merged[0].status).toBe('pending');
  });

  it('local records come first (newest first), then on-chain rows', () => {
    const local = [
      localRec({ hash: '0xlocal-old', timestamp: NOW_B - 1000 }),
      localRec({ hash: '0xlocal-new', timestamp: NOW_B }),
    ];
    const onChain = [
      tx({ id: '0xchain1', hash: '0xchain1', at: NOW_B + 5000 }),
      tx({ id: '0xchain2', hash: '0xchain2', at: NOW_B - 5000 }),
    ];
    const merged = mergeHistoryTxs(local, onChain);
    expect(merged.map((r) => r.hash)).toEqual(['0xlocal-new', '0xlocal-old', '0xchain1', '0xchain2']);
  });

  it('keeps on-chain-only rows (incoming transfers, pre-ledger history)', () => {
    const merged = mergeHistoryTxs([], [tx({ id: '0x1', hash: '0x1' }), tx({ id: '0x2', hash: '0x2' })]);
    expect(merged).toHaveLength(2);
  });

  it('dedupes case-insensitively when the on-chain hash is uppercased', () => {
    const merged = mergeHistoryTxs(
      [localRec({ hash: '0xdeadbeef' })],
      [tx({ id: '0xDEADBEEF', hash: '0xDEADBEEF' })],
    );
    expect(merged).toHaveLength(1);
  });
});

describe('historyRowStatus', () => {
  it('pending / failed / unknown / confirmed each get their own label and tone', () => {
    expect(historyRowStatus('pending')).toEqual({ label: 'Pending', tone: 'wait' });
    expect(historyRowStatus('failed')).toEqual({ label: 'Failed', tone: 'bad' });
    expect(historyRowStatus('unknown')).toEqual({ label: 'Unknown', tone: 'muted' });
    expect(historyRowStatus('confirmed')).toEqual({ label: 'Confirmed', tone: 'ok' });
  });
});

describe('fetchHistory merges the local ledger (Phase B integration)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('local-first: a pending local tx outranks its on-chain twin, and a local-only tx leads', async () => {
    await recordLocalTx(newLocalTx({ hash: '0xABC123', amount: '5', status: 'pending', timestamp: NOW_B + 2000 }));
    await recordLocalTx(newLocalTx({ hash: '0xlocal9', amount: '2', status: 'pending', timestamp: NOW_B + 1000 }));
    mockBlockscout();
    const res = await fetchHistory('arc-mainnet', ME);
    expect(res.status).toBe('ok');
    // 0xabc123 once (local wins), 0xlocal9 local-only, no other rows.
    expect(res.txs).toHaveLength(2);
    expect(res.txs[0].hash).toBe('0xabc123');
    expect(res.txs[0].status).toBe('pending');
    expect(res.txs[0].amount).toBe(5);
    expect(res.txs[0].kind).toBe('sent');
    expect(res.txs[1].hash).toBe('0xlocal9');
    expect(res.txs[1].status).toBe('pending');
  });

  it('when every on-chain source fails, the local ledger still shows instead of an empty error', async () => {
    await recordLocalTx(newLocalTx({ hash: '0xonly-local', amount: '7', status: 'failed', timestamp: NOW_B }));
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const res = await fetchHistory('arc-mainnet', ME);
    expect(res.status).toBe('ok');
    expect(res.error).toBeNull();
    expect(res.txs).toHaveLength(1);
    expect(res.txs[0].hash).toBe('0xonly-local');
    expect(res.txs[0].status).toBe('failed');
  });
});

describe('History screen row states (source checks — Jest is node-only)', () => {
  const MOBILE = path.resolve(__dirname, '..', '..', '..');
  const screen = fs.readFileSync(path.join(MOBILE, 'src/app/(tabs)/history.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(MOBILE, 'src/app/tx/[hash].tsx'), 'utf8');

  it('uses historyRowStatus and shows Pending / Failed / Unknown labels, date only for confirmed rows', () => {
    expect(screen).toContain('historyRowStatus');
    expect(screen).toContain('statusPending');
    expect(screen).toContain('statusFailed');
    expect(screen).toContain('statusUnknown');
    expect(screen).toMatch(/t\.status === 'confirmed' \? date : rowStatus\.label/);
  });

  it('labels the local-only kinds and keeps the tap-to-detail behaviour', () => {
    expect(screen).toContain('Lock broken');
    expect(screen).toContain('Claimed');
    expect(screen).toContain('Approved');
    expect(screen).toContain("pathname: '/tx/[hash]'");
  });

  it('the tx detail pill shows Unknown instead of Pending for unknown rows', () => {
    expect(detail).toContain("status === 'unknown'");
    expect(detail).toContain("'Unknown'");
    expect(detail).toContain('pillMuted');
  });
});
