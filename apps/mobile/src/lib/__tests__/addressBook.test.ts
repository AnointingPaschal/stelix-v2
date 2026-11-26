/**
 * Address book (src/lib/addressBook.ts) — Group B.
 * Real validation (EVM + Solana), duplicate rejection, add/remove round-trip.
 */
import {
  addSavedAddress,
  loadAddressBook,
  removeSavedAddress,
  validateSavedAddress,
} from '../addressBook';

const EVM = '0x1234567890abcdef1234567890abcdef12345678';
const EVM2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SOL = '11111111111111111111111111111111'; // Solana system program — valid base58

describe('validateSavedAddress', () => {
  it('accepts a valid EVM address as evm', () => {
    expect(validateSavedAddress(EVM)).toBe('evm');
  });

  it('accepts a valid Solana address as solana', () => {
    expect(validateSavedAddress(SOL)).toBe('solana');
  });

  it('rejects garbage, empty and truncated addresses', () => {
    expect(validateSavedAddress('not an address')).toBeNull();
    expect(validateSavedAddress('')).toBeNull();
    expect(validateSavedAddress('0x1234')).toBeNull();
  });
});

describe('add / load / remove', () => {
  it('saves a contact and loads it back', async () => {
    const contact = await addSavedAddress('Mum', EVM2);
    expect(contact.label).toBe('Mum');
    expect(contact.kind).toBe('evm');
    const all = await loadAddressBook();
    expect(all.some((c) => c.id === contact.id)).toBe(true);
    await removeSavedAddress(contact.id);
  });

  it('rejects an invalid address with a clear error', async () => {
    await expect(addSavedAddress('Bad', 'hello')).rejects.toThrow(/valid wallet address/);
  });

  it('rejects an empty label', async () => {
    await expect(addSavedAddress('   ', EVM)).rejects.toThrow(/label/);
  });

  it('rejects a duplicate address', async () => {
    const contact = await addSavedAddress('Dup', EVM);
    await expect(addSavedAddress('Dup again', EVM)).rejects.toThrow(/already in your address book/);
    await removeSavedAddress(contact.id);
  });

  it('removes a contact', async () => {
    const contact = await addSavedAddress('Temp', SOL);
    const rest = await removeSavedAddress(contact.id);
    expect(rest.some((c) => c.id === contact.id)).toBe(false);
  });
});
