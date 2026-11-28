/** Local transaction history ledger (Phase A): store + receipt poller. */
import {
  LOCAL_HISTORY_MAX_PER_SCOPE,
  LOCAL_TX_DROPPED_AFTER_MS,
  clearAllLocalHistory,
  listAllPendingLocalTxs,
  listLocalTxs,
  pollPendingLocalTxs,
  pruneLocalTxs,
  recordLocalTx,
  updateLocalTxStatus,
  type NewLocalTx,
} from '../localHistory';

const NOW = 1_800_000_000_000;

// The kv store is shared across tests in this file (in-memory map in
// Jest), so each test starts from an empty ledger.
beforeEach(async () => {
  await clearAllLocalHistory();
});

let walletSeq = 0;
function freshWallet(): string {
  walletSeq += 1;
  return `0x${walletSeq.toString(16).padStart(40, '0')}`;
}

function makeTx(overrides: Partial<NewLocalTx> & { wallet: string; chain: string; hash: string }): NewLocalTx {
  return {
    type: 'send',
    tokenSymbol: 'USDC',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    amount: '30',
    amountRaw: '30000000',
    from: overrides.wallet,
    to: '0x1111111111111111111111111111111111111111',
    timestamp: NOW,
    ...overrides,
  };
}

/** Fake RPC: eth_getTransactionReceipt answers keyed by tx hash. */
function mockRpc(receipts: Record<string, { status: string; blockNumber: string } | null>) {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { params?: string[] };
    const hash = (body.params?.[0] ?? '').toLowerCase();
    const receipt = receipts[hash] ?? null;
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: receipt }),
    } as Response;
  }) as typeof fetch;
}

describe('recordLocalTx / listLocalTxs', () => {
  it('records a tx as pending and lists it newest-first', async () => {
    const wallet = freshWallet();
    const rec = await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: '0xaaa1' }));
    expect(rec.status).toBe('pending');
    expect(rec.blockNumber).toBeNull();
    const listed = await listLocalTxs(wallet, 'arc');
    expect(listed).toHaveLength(1);
    expect(listed[0].hash).toBe('0xaaa1');
  });

  it('keeps wallets and chains separate', async () => {
    const w1 = freshWallet();
    const w2 = freshWallet();
    await recordLocalTx(makeTx({ wallet: w1, chain: 'arc', hash: '0xbbb1' }));
    await recordLocalTx(makeTx({ wallet: w1, chain: 'bnb', hash: '0xbbb2' }));
    await recordLocalTx(makeTx({ wallet: w2, chain: 'arc', hash: '0xbbb3' }));
    expect(await listLocalTxs(w1, 'arc')).toHaveLength(1);
    expect(await listLocalTxs(w1, 'bnb')).toHaveLength(1);
    expect(await listLocalTxs(w2, 'arc')).toHaveLength(1);
    expect(await listLocalTxs(w2, 'bnb')).toHaveLength(0);
  });

  it('re-recording the same hash replaces instead of duplicating', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: '0xCCC1', amount: '10' }));
    await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: '0xccc1', amount: '20' }));
    const listed = await listLocalTxs(wallet, 'arc');
    expect(listed).toHaveLength(1);
    expect(listed[0].amount).toBe('20');
  });

  it('caps each wallet+chain scope at the newest 200 records', async () => {
    const wallet = freshWallet();
    for (let i = 0; i < LOCAL_HISTORY_MAX_PER_SCOPE + 5; i++) {
      await recordLocalTx(
        makeTx({ wallet, chain: 'arc', hash: `0x${(0xdddd0000 + i).toString(16)}`, timestamp: NOW + i }),
      );
    }
    const listed = await listLocalTxs(wallet, 'arc');
    expect(listed).toHaveLength(LOCAL_HISTORY_MAX_PER_SCOPE);
    // Newest first: the last-recorded hash is on top, the oldest pruned.
    expect(listed[0].hash).toBe(`0x${(0xdddd0000 + LOCAL_HISTORY_MAX_PER_SCOPE + 4).toString(16)}`);
    expect(listed.some((r) => r.hash === `0x${(0xdddd0000).toString(16)}`)).toBe(false);
  });
});

describe('updateLocalTxStatus / pruneLocalTxs', () => {
  it('updates status and block number, and returns null for an unknown hash', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'bnb', hash: '0xeee1' }));
    const updated = await updateLocalTxStatus(wallet, 'bnb', '0xEEE1', 'confirmed', 12345);
    expect(updated?.status).toBe('confirmed');
    expect(updated?.blockNumber).toBe(12345);
    expect(await updateLocalTxStatus(wallet, 'bnb', '0xmissing', 'confirmed')).toBeNull();
  });

  it('pruneLocalTxs enforces a smaller cap without touching newer records', async () => {
    const wallet = freshWallet();
    for (let i = 0; i < 5; i++) {
      await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: `0xffff${i}`, timestamp: NOW + i }));
    }
    const kept = await pruneLocalTxs(wallet, 'arc', 2);
    expect(kept).toHaveLength(2);
    expect(kept[0].hash).toBe('0xffff4');
    expect((await listLocalTxs(wallet, 'arc')).map((r) => r.hash)).toEqual(['0xffff4', '0xffff3']);
  });
});

describe('pollPendingLocalTxs (receipt poller)', () => {
  it('moves pending → confirmed with the receipt block number', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: '0x1111' }));
    const fetchImpl = mockRpc({ '0x1111': { status: '0x1', blockNumber: '0x1e240' } });
    const res = await pollPendingLocalTxs({ fetchImpl, now: NOW + 60_000 });
    expect(res).toMatchObject({ checked: 1, confirmed: 1, failed: 0, unknown: 0, stillPending: 0 });
    const [tx] = await listLocalTxs(wallet, 'arc');
    expect(tx.status).toBe('confirmed');
    expect(tx.blockNumber).toBe(123456);
  });

  it('moves pending → failed when the receipt status is 0x0', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'bnb', hash: '0x2222' }));
    const fetchImpl = mockRpc({ '0x2222': { status: '0x0', blockNumber: '0x2a' } });
    const res = await pollPendingLocalTxs({ fetchImpl, now: NOW + 60_000 });
    expect(res.failed).toBe(1);
    const [tx] = await listLocalTxs(wallet, 'bnb');
    expect(tx.status).toBe('failed');
    expect(tx.blockNumber).toBe(42);
  });

  it('leaves a tx pending when no receipt exists yet', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'arc', hash: '0x3333' }));
    const res = await pollPendingLocalTxs({ fetchImpl: mockRpc({}), now: NOW + 60_000 });
    expect(res.stillPending).toBe(1);
    expect((await listLocalTxs(wallet, 'arc'))[0].status).toBe('pending');
  });

  it('marks a stale pending tx unknown after 24h instead of pending forever', async () => {
    const wallet = freshWallet();
    await recordLocalTx(
      makeTx({ wallet, chain: 'arc', hash: '0x4444', timestamp: NOW - LOCAL_TX_DROPPED_AFTER_MS - 1 }),
    );
    const fetchImpl = mockRpc({ '0x4444': { status: '0x1', blockNumber: '0x1' } });
    const res = await pollPendingLocalTxs({ fetchImpl, now: NOW });
    expect(res.unknown).toBe(1);
    // The receipt is never even consulted for a stale record — it is unknown, not confirmed.
    expect((await listLocalTxs(wallet, 'arc'))[0].status).toBe('unknown');
  });

  it('launch backfill: a pending record from a previous session confirms on the next poll', async () => {
    const wallet = freshWallet();
    // Recorded "last session" (2h ago), still inside the 24h window.
    await recordLocalTx(makeTx({ wallet, chain: 'arc-mainnet', hash: '0x5555', timestamp: NOW - 2 * 60 * 60 * 1000 }));
    const fetchImpl = mockRpc({ '0x5555': { status: '0x1', blockNumber: '0x64' } });
    const res = await pollPendingLocalTxs({ fetchImpl, now: NOW });
    expect(res.confirmed).toBe(1);
    expect((await listLocalTxs(wallet, 'arc-mainnet'))[0].status).toBe('confirmed');
  });

  it('does zero network calls when nothing is pending', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ result: null }) } as Response;
    }) as typeof fetch;
    const res = await pollPendingLocalTxs({ fetchImpl, now: NOW });
    expect(res.checked).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('non-EVM chains stay pending until aged out (no receipt to poll)', async () => {
    const wallet = freshWallet();
    await recordLocalTx(makeTx({ wallet, chain: 'solana', hash: '0x6666', tokenSymbol: 'SOL', tokenAddress: null }));
    const res = await pollPendingLocalTxs({ fetchImpl: mockRpc({}), now: NOW + 60_000 });
    expect(res.stillPending).toBe(1);
    expect((await listLocalTxs(wallet, 'solana'))[0].status).toBe('pending');
  });

  it('listAllPendingLocalTxs finds pending records across wallets and chains', async () => {
    const w1 = freshWallet();
    const w2 = freshWallet();
    await recordLocalTx(makeTx({ wallet: w1, chain: 'arc', hash: '0x7771' }));
    await recordLocalTx(makeTx({ wallet: w2, chain: 'base', hash: '0x7772' }));
    await recordLocalTx(makeTx({ wallet: w1, chain: 'arc', hash: '0x7773', status: 'confirmed' }));
    const pending = await listAllPendingLocalTxs();
    const hashes = pending.map((t) => t.hash);
    expect(hashes).toContain('0x7771');
    expect(hashes).toContain('0x7772');
    expect(hashes).not.toContain('0x7773');
  });
});
