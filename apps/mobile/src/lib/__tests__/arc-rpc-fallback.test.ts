/**
 * Arc RPC fallback regression tests (2026-11-27).
 *
 * What broke: the old Arc testnet RPC hostname rpc.testnet.arc.network
 * stopped resolving on device (UnknownHostException) and is absent from
 * current Arc docs, and the wallet had NO fallback — getProvider() used
 * only chain.rpcUrl, so one dead hostname broke Import Token (the
 * resolveTokenMetadata contract read), balances, send and swap.
 *
 * What this pins:
 *   - Arc testnet primary is now https://rpc.testnet.arc.io with the
 *     verified docs.arc.io fallbacks, explorer explorer.testnet.arc.io.
 *   - Arc mainnet (5042) exists in the registry but is DISABLED
 *     (active: false) — not the default, not in the picker.
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

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';

const ARC_TESTNET_RPC_URLS = [
  'https://rpc.testnet.arc.io',
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
];

describe('Arc testnet registry (post rpc.testnet.arc.network outage)', () => {
  it('primary RPC is rpc.testnet.arc.io with the verified .arc.io fallbacks', () => {
    const arc = getChain('arc');
    expect(arc.rpcUrl).toBe('https://rpc.testnet.arc.io');
    expect(arc.rpcUrls).toEqual(ARC_TESTNET_RPC_URLS);
    for (const url of arc.rpcUrls) {
      expect(url).toMatch(/^https:\/\/rpc\.([a-z0-9-]+\.)*testnet\.arc\.io$/);
    }
    expect(arc.rpcUrls).not.toContain('https://rpc.testnet.arc.network');
    expect(arc.rpcUrl).not.toContain('arc.network');
  });

  it('explorer is explorer.testnet.arc.io (old testnet.arcscan.app gone)', () => {
    const arc = getChain('arc');
    expect(arc.explorerUrl).toBe('https://explorer.testnet.arc.io');
    expect(arc.explorerApiUrl).toBe('https://explorer.testnet.arc.io/api');
    expect(arc.explorerUrl).not.toContain('arcscan');
  });

  it('testnet chain id, USDC gas and exit stablecoin are unchanged', () => {
    const arc = getChain('arc');
    expect(arc.chainId).toBe(5042002);
    expect(arc.testnet).toBe(true);
    expect(arc.nativeSymbol).toBe('USDC');
    expect(arc.nativeDecimals).toBe(6);
    expect(arc.exitStablecoinAddress).toBe(ARC_TESTNET_USDC);
  });

  it('getRpcUrls puts the (env-overridable) primary first, then fallbacks, de-duplicated', () => {
    const arc = getChain('arc');
    expect(getRpcUrls(arc)).toEqual(ARC_TESTNET_RPC_URLS);
    // A chain whose primary is also listed in rpcUrls must not duplicate it.
    const dup: ChainConfig = { ...arc, rpcUrl: arc.rpcUrls[1], rpcUrls: [...arc.rpcUrls] };
    expect(getRpcUrls(dup)[0]).toBe(arc.rpcUrls[1]);
    expect(new Set(getRpcUrls(dup)).size).toBe(getRpcUrls(dup).length);
  });

  it('EXPO_PUBLIC_ARC_RPC_URL still overrides the primary RPC', () => {
    const custom = 'https://custom-arc-rpc.example/rpc';
    jest.isolateModules(() => {
      const prev = process.env.EXPO_PUBLIC_ARC_RPC_URL;
      process.env.EXPO_PUBLIC_ARC_RPC_URL = custom;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const freshChains = require('../chains') as typeof import('../chains');
        expect(freshChains.getChain('arc').rpcUrl).toBe(custom);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const freshBalances = require('../balances') as typeof import('../balances');
        expect(freshBalances.getRpcUrls(freshChains.getChain('arc'))[0]).toBe(custom);
      } finally {
        if (prev === undefined) delete process.env.EXPO_PUBLIC_ARC_RPC_URL;
        else process.env.EXPO_PUBLIC_ARC_RPC_URL = prev;
      }
    });
  });
});

describe('Arc mainnet registry (disabled by default)', () => {
  it('exists with chain 5042, mainnet RPC/explorer, same USDC and the Uniswap routers', () => {
    const mainnet = getChain('arc-mainnet');
    expect(mainnet.chainId).toBe(5042);
    expect(mainnet.rpcUrl).toBe('https://rpc.mainnet.arc.io');
    expect(mainnet.rpcUrls).toEqual(['https://rpc.mainnet.arc.io']);
    expect(mainnet.explorerUrl).toBe('https://explorer.arc.io');
    expect(mainnet.explorerApiUrl).toBe('https://explorer.arc.io/api');
    expect(mainnet.nativeSymbol).toBe('USDC');
    expect(mainnet.nativeDecimals).toBe(6);
    expect(mainnet.exitStablecoin).toBe('USDC');
    expect(mainnet.exitStablecoinAddress).toBe(ARC_TESTNET_USDC);
    expect(mainnet.uniswapV3Router).toBe('0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77');
    expect(mainnet.uniswapV2Router).toBe('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA');
    expect(mainnet.status).toBe('live');
    expect(getChainByEvmId(5042)?.id).toBe('arc-mainnet');
    expect(getChainByEvmId(5042002)?.id).toBe('arc');
  });

  it('is NOT active, NOT selectable, and NOT the default — wallet stays testnet-first for Arc', () => {
    const mainnet = getChain('arc-mainnet');
    expect(mainnet.active).toBe(false);
    expect(isChainActive('arc-mainnet')).toBe(false);
    expect(ACTIVE_CHAINS.map((c) => c.id)).not.toContain('arc-mainnet');
    expect(DEFAULT_CHAIN.id).toBe('arc');
    expect(DEFAULT_CHAIN.chainId).toBe(5042002);
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
      return '0x4cef52'; // 5042002
    case 'net_version':
      return '5042002';
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

  /** Arc chain config whose primary is dead (port 9, nothing listening)
   *  and whose only live RPC is the local stub — the exact shape of the
   *  rpc.testnet.arc.network outage. */
  function deadPrimaryChain(): ChainConfig {
    const arc = getChain('arc');
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
    const meta = await resolveTokenMetadata(deadPrimaryChain(), ARC_TESTNET_USDC);
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
