/**
 * Import Token address field — pure logic, no React Native imports, so it
 * is unit-testable under Jest (this app has no component-test setup).
 *
 * The textbox must never crash on focus, typing, paste or clear: every
 * path here is guarded, a pending preview fetch is cancelled when the
 * text is cleared or becomes invalid, and a valid paste fires exactly
 * one fetch after the debounce.
 */
import { kvGet, kvSet } from './storage';
import type { ImportedToken } from './balances';

export const CONTRACT_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const IMPORT_ADDRESS_ERROR =
  'Enter a valid contract address (0x followed by 40 hex characters).';

export function isValidContractAddress(value: string): boolean {
  return CONTRACT_ADDRESS_RE.test(value.trim());
}

/**
 * Inline error for the address field while typing. A partial address
 * that could still become valid (e.g. "0x6Ec9…") shows no error, so a
 * half-typed address never flashes one; a complete-looking or malformed
 * value (42+ chars, or a non-hex character) does. A short invalid value
 * such as "0x1234" is caught on blur / submit instead — see
 * createImportInputController.blur.
 */
export function importAddressError(value: string): string {
  const a = value.trim();
  if (a === '' || isValidContractAddress(a)) return '';
  if (a.length >= 42) return IMPORT_ADDRESS_ERROR;
  if (/^0x[0-9a-fA-F]*[^0-9a-fA-F]/.test(a)) return IMPORT_ADDRESS_ERROR;
  if (!/^0x/i.test(a) && /[^0-9a-fA-F]/.test(a)) return IMPORT_ADDRESS_ERROR;
  return '';
}

export interface ImportInputCallbacks {
  /** A valid 0x address, debounced — fetch its metadata/logo/price. */
  onValidAddress: (address: string) => void;
  /** Complete-looking but invalid address — show the inline error. */
  onInvalidAddress: (message: string) => void;
  /** Empty or still-typing partial address — clear preview + message. */
  onCleared: () => void;
}

/** Debounced handler for the contract-address textbox. */
export function createImportInputController(
  callbacks: ImportInputCallbacks,
  debounceMs = 400,
): {
  change: (value: string) => void;
  blur: (value: string) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    change(value: string) {
      cancel();
      const err = importAddressError(value);
      if (err) {
        callbacks.onInvalidAddress(err);
        return;
      }
      const a = value.trim();
      if (isValidContractAddress(a)) {
        timer = setTimeout(() => {
          timer = null;
          callbacks.onValidAddress(a);
        }, debounceMs);
        return;
      }
      callbacks.onCleared();
    },

    blur(value: string) {
      // Leaving the field with a non-empty invalid address is a visible
      // inline error — a short pasted value like 0x1234 is caught here,
      // not while the user is still typing it.
      const a = value.trim();
      if (a !== '' && !isValidContractAddress(a)) {
        cancel();
        callbacks.onInvalidAddress(IMPORT_ADDRESS_ERROR);
      }
    },

    cancel,
  };
}

// ---------------------------------------------------------------------------
// Search-mode detection (import screen: one input, two modes)
// ---------------------------------------------------------------------------

/** What the import screen's single search box should do with its text:
 *  a full 0x address fetches that exact token; anything else searches
 *  DexScreener by name/symbol; blank shows nothing. Pure, unit-tested. */
export type ImportSearchMode = 'empty' | 'address' | 'search';

export function detectImportSearchMode(value: string): ImportSearchMode {
  const v = value.trim();
  if (v === '') return 'empty';
  return isValidContractAddress(v) ? 'address' : 'search';
}

/** True while the text looks like a half-typed contract address
 *  (0x + 1–39 hex chars): the screen shows a hint instead of running
 *  a name search that can never match it. */
export function isPartialContractAddress(value: string): boolean {
  const v = value.trim();
  return /^0x[0-9a-fA-F]{1,39}$/.test(v);
}

// ---------------------------------------------------------------------------
// Hidden tokens — a discovered/imported token toggled OFF stays off.
// ---------------------------------------------------------------------------

/** Per-wallet hidden set: tokens the user toggled off in the import
 *  screen. Stored as a JSON array of `chainId:address` keys so a
 *  re-discovered token (same address, next refresh) is recognised and
 *  skipped instead of reappearing in My Assets. */
export const HIDDEN_TOKENS_KEY_PREFIX = 'stelix_hidden_tokens_v1';

export function hiddenTokensKey(ownerAddress?: string): string {
  return ownerAddress
    ? `${HIDDEN_TOKENS_KEY_PREFIX}:${ownerAddress.toLowerCase()}`
    : HIDDEN_TOKENS_KEY_PREFIX;
}

/** One hidden-set entry: `${chainId}:${lowercase address}`. Pure. */
export function hiddenTokenKey(chainId: string, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

/** Parse a stored hidden set; malformed storage parses as empty, never throws. */
export function parseHiddenSet(raw: string | null): Set<string> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/** Pure membership check — the piece balances.ts uses in its discovery
 *  merge path, so that file stays free of storage-key knowledge. */
export function isTokenHidden(hidden: Set<string>, chainId: string, address: string): boolean {
  return hidden.has(hiddenTokenKey(chainId, address));
}

export async function loadHiddenTokens(ownerAddress?: string): Promise<Set<string>> {
  try {
    return parseHiddenSet(await kvGet(hiddenTokensKey(ownerAddress)));
  } catch {
    return new Set();
  }
}

async function saveHiddenTokens(hidden: Set<string>, ownerAddress?: string): Promise<void> {
  await kvSet(hiddenTokensKey(ownerAddress), JSON.stringify([...hidden]));
}

/** Record a token as hidden (toggled off). Returns the updated set. */
export async function hideToken(
  chainId: string,
  address: string,
  ownerAddress?: string,
): Promise<Set<string>> {
  const hidden = await loadHiddenTokens(ownerAddress);
  hidden.add(hiddenTokenKey(chainId, address));
  await saveHiddenTokens(hidden, ownerAddress);
  return hidden;
}

/** Remove a token from the hidden set (toggled back on). */
export async function unhideToken(
  chainId: string,
  address: string,
  ownerAddress?: string,
): Promise<Set<string>> {
  const hidden = await loadHiddenTokens(ownerAddress);
  hidden.delete(hiddenTokenKey(chainId, address));
  await saveHiddenTokens(hidden, ownerAddress);
  return hidden;
}

/** Persistence behind a visibility toggle, injected so this module
 *  never imports balances.ts at runtime (balances.ts imports this
 *  module for the hidden-set read — a value import back would cycle). */
export interface ToggleTokenDeps {
  addImportedToken: (token: ImportedToken, ownerAddress?: string) => Promise<unknown>;
  removeImportedToken: (
    chainId: string,
    address: string,
    ownerAddress?: string,
  ) => Promise<unknown>;
}

/**
 * Flip one token's visibility in My Assets.
 * - ON: adds the token via addImportedToken and clears any hidden
 *   record, so a previously hidden token can come back.
 * - OFF: removes it from the imported list AND records it in the
 *   per-wallet hidden set, so auto-discovery cannot re-add it on the
 *   next refresh. `token` (full row) is required when turning ON.
 * Derived rows (default stables, registry tokens) are never passed
 * here — they are not in the imported list, so they cannot be toggled
 * off; the screen disables their toggle instead.
 */
export async function setTokenVisibility(opts: {
  chainId: string;
  address: string;
  token: ImportedToken | null;
  visible: boolean;
  ownerAddress?: string;
  deps: ToggleTokenDeps;
}): Promise<void> {
  if (opts.visible) {
    if (!opts.token) throw new Error('Token details are needed to activate this token.');
    await opts.deps.addImportedToken(opts.token, opts.ownerAddress);
    await unhideToken(opts.chainId, opts.address, opts.ownerAddress);
  } else {
    await opts.deps.removeImportedToken(opts.chainId, opts.address, opts.ownerAddress);
    await hideToken(opts.chainId, opts.address, opts.ownerAddress);
  }
}
