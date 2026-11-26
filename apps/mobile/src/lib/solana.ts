/**
 * LIVE Solana — real RPC reads via @solana/web3.js, no placeholder data.
 *
 * - Address: derived from the wallet's BIP-39 mnemonic at the standard
 *   Solana path m/44'/501'/0'/0' (SLIP-0010 ed25519). The derivation
 *   happens at wallet create/import time and only the PUBLIC address is
 *   stored (see lib/wallet.ts). Wallets imported from a raw private key
 *   have no mnemonic, so they have no Solana address — the Solana chain
 *   then says so honestly instead of inventing one.
 * - Balances: Connection.getBalance (SOL) + getParsedTokenAccountsByOwner
 *   (SPL tokens, jsonParsed). Symbols/prices come from DexScreener by
 *   mint (see lib/prices.ts); a mint with no DexScreener pair is listed
 *   by its truncated mint address with no price, never a guessed symbol.
 * - History: getSignaturesForAddress + getParsedTransaction, parsed from
 *   pre/post SOL and token balances — real on-chain transfers only.
 * - Vault: Solana vault is an Anchor program — NOT wired here (see
 *   lib/vault.ts). Locks on Solana refuse honestly.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import { ethers } from 'ethers';
import { getChain } from './chains';

export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/** Derive the Solana base58 address from a BIP-39 mnemonic.
 *  Throws on an invalid mnemonic. Pure derivation — no network call. */
export function deriveSolanaAddress(mnemonic: string): string {
  const phrase = mnemonic.trim();
  if (!ethers.Mnemonic.isValidMnemonic(phrase)) {
    throw new Error('Invalid seed phrase — cannot derive a Solana address.');
  }
  const seedHex = ethers.Mnemonic.fromPhrase(phrase).computeSeed().replace(/^0x/, '');
  const derived = derivePath(SOLANA_DERIVATION_PATH, seedHex);
  if (!derived.key || derived.key.length !== 32) {
    throw new Error('Solana key derivation failed.');
  }
  return Keypair.fromSeed(Uint8Array.from(derived.key)).publicKey.toBase58();
}

/** Validate a Solana base58 address format (32–44 base58 chars).
 *  Format-only — it does not prove the account exists on-chain. */
export function isValidSolanaAddress(addr: string): boolean {
  try {
    const pk = new PublicKey(addr.trim());
    return pk.toBase58() === addr.trim();
  } catch {
    return false;
  }
}

export function getSolanaConnection(chainId = 'solana'): Connection {
  const chain = getChain(chainId);
  return new Connection(chain.rpcUrl, 'confirmed');
}

export interface SolanaSplBalance {
  mint: string;
  balance: number; // token units (float, display only)
  balanceRaw: string;
  decimals: number;
}

export interface SolanaBalances {
  address: string;
  lamports: number;
  sol: number;
  tokens: SolanaSplBalance[];
}

/** SOL + SPL token balances for an address. Empty when the account
 *  holds nothing — never a placeholder. */
export async function fetchSolanaBalances(
  address: string,
  connection?: Connection,
): Promise<SolanaBalances> {
  const conn = connection ?? getSolanaConnection();
  const pubkey = new PublicKey(address);
  const lamports = await conn.getBalance(pubkey);
  const parsed = await conn.getParsedTokenAccountsByOwner(pubkey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });
  const tokens: SolanaSplBalance[] = [];
  for (const { account } of parsed.value) {
    const info = (account.data as { parsed?: { info?: {
      mint?: string;
      tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null };
    } } }).parsed?.info;
    const amountRaw = info?.tokenAmount?.amount;
    if (!info?.mint || amountRaw === undefined) continue;
    const decimals = info.tokenAmount?.decimals ?? 0;
    tokens.push({
      mint: info.mint,
      balance: info.tokenAmount?.uiAmount ?? Number(amountRaw) / 10 ** decimals,
      balanceRaw: amountRaw,
      decimals,
    });
  }
  return { address, lamports, sol: lamports / LAMPORTS_PER_SOL, tokens };
}

export interface SolanaTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Net SOL change for the address (negative = sent, positive = received). */
  solChange: number;
  /** Net SPL changes: mint -> signed token-unit change. */
  tokenChanges: { mint: string; change: number; decimals: number }[];
  fee: number;
  failed: boolean;
}

/** Recent signatures for an address, each parsed from pre/post balances.
 *  Only transactions whose balances actually changed for this address
 *  are returned (pure fee-only / unrelated txs are skipped). */
export async function fetchSolanaHistory(
  address: string,
  limit = 25,
  connection?: Connection,
): Promise<SolanaTx[]> {
  const conn = connection ?? getSolanaConnection();
  const pubkey = new PublicKey(address);
  const sigs = await conn.getSignaturesForAddress(pubkey, { limit });
  const out: SolanaTx[] = [];
  for (const sig of sigs) {
    try {
      const parsed = await conn.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!parsed?.meta) continue;
      const keys = parsed.transaction.message.accountKeys.map((k) =>
        typeof k === 'string' ? k : (k as { pubkey?: { toBase58?: () => string } }).pubkey?.toBase58?.() ?? String(k),
      );
      const idx = keys.findIndex((k) => k === address);
      const meta = parsed.meta as {
        preBalances?: number[];
        postBalances?: number[];
        preTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null; decimals?: number } }[];
        postTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null; decimals?: number } }[];
        fee?: number;
        err?: unknown;
      };
      const solChange =
        idx >= 0
          ? ((meta.postBalances?.[idx] ?? 0) - (meta.preBalances?.[idx] ?? 0)) / LAMPORTS_PER_SOL
          : 0;
      const tokenChanges: SolanaTx['tokenChanges'] = [];
      const before = new Map<string, { amount: number; decimals: number }>();
      for (const b of meta.preTokenBalances ?? []) {
        if (b.owner === address && b.mint) {
          before.set(b.mint, { amount: b.uiTokenAmount?.uiAmount ?? 0, decimals: b.uiTokenAmount?.decimals ?? 0 });
        }
      }
      for (const b of meta.postTokenBalances ?? []) {
        if (b.owner === address && b.mint) {
          const prev = before.get(b.mint);
          const after = b.uiTokenAmount?.uiAmount ?? 0;
          const change = after - (prev?.amount ?? 0);
          if (change !== 0) {
            tokenChanges.push({ mint: b.mint, change, decimals: b.uiTokenAmount?.decimals ?? prev?.decimals ?? 0 });
          }
          before.delete(b.mint);
        }
      }
      // Tokens that disappeared entirely (closed accounts).
      for (const [mint, v] of before) {
        if (v.amount !== 0) tokenChanges.push({ mint, change: -v.amount, decimals: v.decimals });
      }
      if (solChange === 0 && tokenChanges.length === 0) continue; // no movement for this address
      out.push({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime ?? null,
        solChange,
        tokenChanges,
        fee: (meta.fee ?? 0) / LAMPORTS_PER_SOL,
        failed: sig.err !== null || meta.err !== null,
      });
    } catch {
      continue; // unparsable tx: skipped, never invented
    }
  }
  return out;
}
