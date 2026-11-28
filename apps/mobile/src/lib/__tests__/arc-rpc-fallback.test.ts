/**
 * Arc RPC fallback regression tests (2026-11-27, mainnet-first 2026-11-28).
 *
 * What broke in 2026-11-27: the old Arc RPC hostname stopped
 * resolving on device (UnknownHostException) and the wallet had NO
 * fallback — getProvider() used only chain.rpcUrl, so one dead
 * hostname broke Import Token (the resolveTokenMetadata contract
 * read), balances, send and swap.
 *
 * What this pins:
 *   - Arc Mainnet (5042) is the default chain: primary
 *     https://rpc.mainnet.arc.io, explorer https://explorer.arc.io.
 *   - There is no hardcoded Arc testnet entry any more: a testnet
 *     appears only when the admin serves it through /api/sync.
 *   - getProvider() falls back to a live RPC when the primary fails,
 *     proven against a local stub JSON-RPC server (no live network).
 */
import http from 'http';
import { ethers } from 'ethers';
import {
  ACTIVE_CHAINS,
  DEFAULT_CHAIN,
  getChain,
  getChainByEvmId,
  isChainActive,
  type ChainConfig,
} from '../chains';
import { getProvider, getRpcUrls, resolveTokenMetadata } from '../balances';

const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000';

const ARC_MAINNET_RPC_URLS = ['https://rpc.mainnet.arc.io'];

describe('Arc Mainnet registry', () => {
  it('primary RPC is rpc.mainnet.arc.io, explorer explorer.arc.io', () => {
    const arc = getChain('arc-mainnet');
    expect(arc.rpcUrl).toBe('https://rpc.mainnet.arc.io');
    expect(arc.rpcUrls).toEqual(ARC_MAINNET_RPC_URLS);
    expect(arc.explorerUrl).toBe('https://explorer.arc.io');
    expect(arc.explorerApiUrl).toBe('https://explorer.arc.io/api');
    expect(arc.explorerUrl).not.toContain('arcscan');
  });

  it('mainnet chain id, USDC gas and exit stablecoin', () => {
    const arc = getChain('arc-mainnet');
    expect(arc.chainId).toBe(5042);
    expect(arc.testnet).toBeUndefined();
    expect(arc.status).toBe('live');
    expect(arc.nativeSymbol).toBe('USDC');
    expect(arc.nativeDecimals).toBe(6);
    expect(arc.exitStablecoinAddress).toBe(ARC_MAINNET_USDC);
  });

  it('is the default, active and selectable', () => {
    expect(DEFAULT_CHAIN.id).toBe('arc-mainnet');
    expect(DEFAULT_CHAIN.chainId).toBe(5042);
    expect(isChainActive('arc-mainnet')).toBe(true);
    expect(ACTIVE_CHAINS.map((c) => c.id)).toContain('arc-mainnet');
    expect(getChainByEvmId(5042)?.id).toBe('arc-mainnet');
    expect(getChainByEvmId(5042002)).toBeNull();
  });

  it('getRpcUrls puts the (env-overridable) primary first, then fallbacks, de-duplicated', () => {
    const arc = getChain('arc-mainnet');
    expect(getRpcUrls(arc)).toEqual(ARC_MAINNET_RPC_URLS);
    // A chain whose primary is also listed in rpcUrls must not duplicate it.
    const dup: ChainConfig = { ...arc, rpcUrl: arc.rpcUrls[0], rpcUrls: [...arc.rpcUrls] };
    expect(getRpcUrls(dup)[0]).toBe(arc.rpcUrls[0]);
    expect(new Set(getRpcUrls(dup)).size).toBe(getRpcUrls(dup).length);
  });

  it('EXPO_PUBLIC_ARC_MAINNET_RPC_URL still overrides the primary RPC', () => {
    const custom = 'https://custom-arc-rpc.example/rpc';
    jest.isolateModules(() => {
      const prev = process.env.EXPO_PUBLIC_ARC_MAINNET_RPC_URL;
      process.env.EXPO_PUBLIC_ARC_MAINNET_RPC_URL = custom;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const freshChains = require('../chains') as typeof import('../chains');
        expect(freshChains.getChain('arc-mainnet').rpcUrl).toBe(custom);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const freshBalances = require('../balances') as typeof import('../balances');
        expect(freshBalances.getRpcUrls(freshChains.getChain('arc-mainnet'))[0]).toBe(custom);
      } finally {
        if (prev === undefined) delete process.env.EXPO_PUBLIC_ARC_MAINNET_RPC_URL;
        else process.env.EXPO_PUBLIC_ARC_MAINNET_RPC_URL = prev;
      }
    });
  });
});

/**
 * Minimal JSON-RPC stub: answers the calls ethers makes for a
 * getBlockNumber / getBalance / eth_call (ERC-20 symbol/name/decimals)
 * through a FallbackProvider. Anything else gets a harmless 0x0.
 */
function stubRpcResult(method: string, params: unknown[]): unknown {
  const coder = new ethers.AbiCoder();
  switch (method) {
    case 'eth_chainId':
      return '0x13b2'; // 5042
    case 'net_version':
      return '5042';
    case 'eth_blockNumber':
      return '0x1234';
    case 'eth_getBalance':
      return '0x0';
    case 'eth_getTransactionCount':
      return '0x0';
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x0';
    case 'eth_getBlockByNumber':
      return {
        number: '0x1234',
        hash: `0x${'0'.repeat(64)}`,
        parentHash: `0x${'0'.repeat(64)}`,
        timestamp: '0x0',
        baseFeePerGas: '0x0',
        gasLimit: '0x0',
        gasUsed: '0x0',
        transactions: [],
      };
    case 'eth_call': {
      const tx = (params?.[0] ?? {}) as { data?: string };
      const selector = (tx.data ?? '').slice(0, 10).toLowerCase();
      if (selector === '0x95d89b41') return coder.encode(['string'], ['USDC']); // symbol()
      if (selector === '0x06fdde03') return coder.encode(['string'], ['USD Coin']); // name()
      if (selector === '0x313ce567') return coder.encode(['uint8'], [6]); // decimals()
      return '0x';
    }
    default:
      return '0x0';
  }
}

describe('getProvider() RPC fallback (dead primary -> live fallback)', () => {
  let server: http.Server;
  let stubUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as
            | { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] }
            | Array<{ jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] }>;
          const answer = (call: {
            jsonrpc?: string;
            id?: unknown;
            method?: string;
            params?: unknown[];
          }) => ({
            jsonrpc: '2.0',
            id: call.id ?? null,
            result: stubRpcResult(call.method ?? '', (call.params ?? []) as unknown[]),
          });
          const payload = Array.isArray(body) ? body.map(answer) : answer(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('stub server did not bind');
    stubUrl = `http://127.0.0.1:${addr.port}/rpc`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /** Arc Mainnet chain config whose primary is dead (port 9, nothing
   *  listening) and whose only live RPC is the local stub — the exact
   *  shape of the 2026-11-27 outage. */
  function deadPrimaryChain(): ChainConfig {
    const arc = getChain('arc-mainnet');
    return {
      ...arc,
      rpcUrl: 'http://127.0.0.1:9/rpc',
      rpcUrls: ['http://127.0.0.1:9/rpc', stubUrl],
    };
  }

  it('falls back to the live RPC for getBlockNumber when the primary is dead', async () => {
    const provider = getProvider(deadPrimaryChain());
    await expect(provider.getBlockNumber()).resolves.toBe(0x1234);
  }, 15000);

  it('falls back for the Import Token path: resolveTokenMetadata reads USDC via the live RPC', async () => {
    const meta = await resolveTokenMetadata(deadPrimaryChain(), ARC_MAINNET_USDC);
    expect(meta).toEqual({ symbol: 'USDC', name: 'USD Coin', decimals: 6 });
  }, 15000);

  it('a chain with a single RPC still gets a plain JsonRpcProvider', () => {
    const single: ChainConfig = {
      ...getChain('arc-mainnet'),
      rpcUrl: 'https://rpc.mainnet.arc.io',
      rpcUrls: ['https://rpc.mainnet.arc.io'],
    };
    expect(getProvider(single)).toBeInstanceOf(ethers.JsonRpcProvider);
  });
});
