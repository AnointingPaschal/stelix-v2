/**
 * Import Token address field — pure logic, no React Native imports, so it
 * is unit-testable under Jest (this app has no component-test setup).
 *
 * The textbox must never crash on focus, typing, paste or clear: every
 * path here is guarded, a pending preview fetch is cancelled when the
 * text is cleared or becomes invalid, and a valid paste fires exactly
 * one fetch after the debounce.
 */
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
