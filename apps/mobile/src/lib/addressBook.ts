/**
 * Address book — saved recipient addresses for Send (and any future
 * recipient picker). Stored in the same non-secret kv storage as the
 * imported-token list (localStorage on web; in-memory only on native
 * until a durable store lands — see lib/storage.ts). Never stores a
 * secret; addresses are public by design.
 *
 * Validation is real: EVM addresses must pass ethers.isAddress,
 * Solana addresses must pass the PublicKey check in lib/solana.ts
 * (via lib/wallet.ts). Anything else is rejected with a message.
 */
import { kvGet, kvSet } from './storage';
import { isValidEvmAddress, isValidSolanaAddress } from './wallet';
import { shortAddr } from './signing';

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  kind: 'evm' | 'solana';
  createdAt: number;
}

export const ADDRESS_BOOK_KEY = 'stelix_address_book_v1';

/** 'evm' / 'solana' when the address is valid on that chain, else null. */
export function validateSavedAddress(address: string): 'evm' | 'solana' | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  if (isValidEvmAddress(trimmed)) return 'evm';
  if (isValidSolanaAddress(trimmed)) return 'solana';
  return null;
}

export async function loadAddressBook(): Promise<SavedAddress[]> {
  try {
    const raw = await kvGet(ADDRESS_BOOK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedAddress[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c) => c && typeof c.address === 'string' && validateSavedAddress(c.address) !== null,
    );
  } catch {
    return [];
  }
}

async function saveAll(contacts: SavedAddress[]): Promise<void> {
  await kvSet(ADDRESS_BOOK_KEY, JSON.stringify(contacts));
}

/** Add a contact. Throws on an invalid address, a duplicate address,
 *  or an empty label. Returns the saved contact. */
export async function addSavedAddress(label: string, address: string): Promise<SavedAddress> {
  const kind = validateSavedAddress(address);
  if (!kind) {
    throw new Error('That does not look like a valid wallet address (EVM 0x… or Solana base58).');
  }
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error('Give the address a label (e.g. “Mum” or “Exchange”).');
  const contacts = await loadAddressBook();
  const normalized = address.trim();
  if (contacts.some((c) => c.address.toLowerCase() === normalized.toLowerCase())) {
    throw new Error('That address is already in your address book.');
  }
  const contact: SavedAddress = {
    id: `addr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    label: cleanLabel,
    address: normalized,
    kind,
    createdAt: Date.now(),
  };
  await saveAll([contact, ...contacts]);
  return contact;
}

/** Remove a contact by id. Returns the remaining contacts. */
export async function removeSavedAddress(id: string): Promise<SavedAddress[]> {
  const contacts = await loadAddressBook();
  const next = contacts.filter((c) => c.id !== id);
  await saveAll(next);
  return next;
}

/** Short display form, e.g. 0x1234…5678. */
export function displaySavedAddress(address: string): string {
  return shortAddr(address, 6);
}
