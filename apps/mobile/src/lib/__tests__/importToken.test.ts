/**
 * Import Token textbox — regression tests for the 2026-11-26 crash: the
 * contract-address field must accept focus, typing, paste and clear
 * without throwing, must fire exactly one debounced preview fetch for a
 * valid pasted address, and must show a visible inline error for an
 * invalid address instead of failing silently.
 *
 * Note: this app has no component-test setup (no @testing-library /
 * react-test-renderer — Jest runs pure-logic suites only), so the
 * textbox's handler logic is tested here through the pure controller in
 * lib/importToken.ts, which is what the Home screen wires to its
 * TextInput. The remaining crash cause — the BottomSheet backdrop
 * Pressable wrapping the textbox — is a layout fix in components/ui.tsx
 * and is covered by inspection, not by a unit test.
 */
import {
  createImportInputController,
  importAddressError,
  IMPORT_ADDRESS_ERROR,
  isValidContractAddress,
} from '../importToken';

const WKC = '0x6Ec90334d89dBdc89E08A133271be3d104128Edb'; // WKC on BSC

describe('isValidContractAddress', () => {
  it('accepts the WKC contract address (mixed case, with whitespace)', () => {
    expect(isValidContractAddress(WKC)).toBe(true);
    expect(isValidContractAddress(`  ${WKC}  `)).toBe(true);
    expect(isValidContractAddress(WKC.toLowerCase())).toBe(true);
  });

  it('rejects short, malformed and empty addresses', () => {
    expect(isValidContractAddress('0x1234')).toBe(false);
    expect(isValidContractAddress('0x6Ec90334d89dBdc89E08A133271be3d104128Ed')).toBe(false); // 39 hex
    expect(isValidContractAddress('0xZZZZ0334d89dBdc89E08A133271be3d104128Edb')).toBe(false);
    expect(isValidContractAddress('')).toBe(false);
    expect(isValidContractAddress('not an address')).toBe(false);
  });
});

describe('importAddressError', () => {
  it('stays silent while the user is still typing a partial address', () => {
    expect(importAddressError('')).toBe('');
    expect(importAddressError('0x')).toBe('');
    expect(importAddressError('0x6Ec9')).toBe('');
    expect(importAddressError(WKC.slice(0, 20))).toBe('');
    expect(importAddressError(WKC)).toBe('');
  });

  it('flags a complete-looking or malformed address inline', () => {
    expect(importAddressError('0x' + '1'.repeat(41))).toBe(IMPORT_ADDRESS_ERROR);
    expect(importAddressError('0x1234zz')).toBe(IMPORT_ADDRESS_ERROR);
    expect(importAddressError('hello world this is not an address at all!!')).toBe(IMPORT_ADDRESS_ERROR);
  });
});

describe('createImportInputController (focus / typing / paste / clear)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const onValidAddress = jest.fn();
    const onInvalidAddress = jest.fn();
    const onCleared = jest.fn();
    const c = createImportInputController({ onValidAddress, onInvalidAddress, onCleared });
    return { c, onValidAddress, onInvalidAddress, onCleared };
  }

  it('typing character by character never throws, never fetches, never errors', () => {
    const { c, onValidAddress, onInvalidAddress, onCleared } = setup();
    let partial = '';
    for (const ch of WKC) {
      partial += ch;
      expect(() => c.change(partial)).not.toThrow();
    }
    // Only the final, complete address schedules a fetch — once.
    jest.advanceTimersByTime(399);
    expect(onValidAddress).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onValidAddress).toHaveBeenCalledTimes(1);
    expect(onValidAddress).toHaveBeenCalledWith(WKC);
    expect(onInvalidAddress).not.toHaveBeenCalled();
    expect(onCleared).toHaveBeenCalled();
  });

  it('pasting a valid address fires exactly one debounced fetch', () => {
    const { c, onValidAddress } = setup();
    expect(() => c.change(WKC)).not.toThrow();
    jest.advanceTimersByTime(400);
    expect(onValidAddress).toHaveBeenCalledTimes(1);
    expect(onValidAddress).toHaveBeenCalledWith(WKC);
  });

  it('pasting an invalid address shows an inline error and never fetches', () => {
    const { c, onValidAddress, onInvalidAddress } = setup();
    expect(() => c.change('0x' + '1'.repeat(41))).not.toThrow();
    jest.advanceTimersByTime(1000);
    expect(onValidAddress).not.toHaveBeenCalled();
    expect(onInvalidAddress).toHaveBeenCalledWith(IMPORT_ADDRESS_ERROR);
  });

  it('a short invalid address like 0x1234 errors on blur, not while typing', () => {
    const { c, onValidAddress, onInvalidAddress } = setup();
    expect(() => c.change('0x1234')).not.toThrow();
    expect(onInvalidAddress).not.toHaveBeenCalled();
    expect(() => c.blur('0x1234')).not.toThrow();
    expect(onInvalidAddress).toHaveBeenCalledWith(IMPORT_ADDRESS_ERROR);
    jest.advanceTimersByTime(1000);
    expect(onValidAddress).not.toHaveBeenCalled();
  });

  it('clearing the field cancels a pending fetch — no stale preview', () => {
    const { c, onValidAddress, onCleared } = setup();
    c.change(WKC);
    expect(() => c.change('')).not.toThrow();
    jest.advanceTimersByTime(1000);
    expect(onValidAddress).not.toHaveBeenCalled();
    expect(onCleared).toHaveBeenCalled();
  });

  it('retyping a different address replaces the pending fetch', () => {
    const { c, onValidAddress } = setup();
    const other = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC
    c.change(WKC);
    jest.advanceTimersByTime(200);
    c.change(other);
    jest.advanceTimersByTime(400);
    expect(onValidAddress).toHaveBeenCalledTimes(1);
    expect(onValidAddress).toHaveBeenCalledWith(other);
  });

  it('cancel() drops a pending fetch', () => {
    const { c, onValidAddress } = setup();
    c.change(WKC);
    c.cancel();
    jest.advanceTimersByTime(1000);
    expect(onValidAddress).not.toHaveBeenCalled();
  });
});
