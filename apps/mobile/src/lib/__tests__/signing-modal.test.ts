/**
 * Signing modal — no inline session-password field may remain on any
 * on-chain screen, and every on-chain screen must sign through the one
 * shared SignTransactionModal. Pure helpers + source checks, following
 * the no-placeholder test pattern (fs reads, no RN imports).
 */
import * as fs from 'fs';
import * as path from 'path';
import { isWrongPasswordError, shortAddr, validateSignPassword } from '../signing';

const SRC = path.resolve(__dirname, '..', '..');
const APP = path.join(SRC, 'app');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** On-chain screens: the only places a transaction could previously be
 *  signed from an inline password field. */
const ONCHAIN_SCREENS = [
  'app/send.tsx',
  'app/(tabs)/swap.tsx',
  'app/vault/create.tsx',
  'app/vault/[id].tsx',
];

describe('validateSignPassword', () => {
  it('rejects empty and short passwords before the wallet is touched', () => {
    expect(validateSignPassword('')).toMatch(/at least 8/);
    expect(validateSignPassword('short')).toMatch(/at least 8/);
  });

  it('accepts an 8+ character password for the decrypt attempt', () => {
    expect(validateSignPassword('Test1234')).toBeNull();
  });
});

describe('isWrongPasswordError', () => {
  it('recognises the decrypt failure the wallet throws on a wrong password', () => {
    expect(isWrongPasswordError(new Error('Wrong password — wallet could not be unlocked.'))).toBe(true);
  });

  it('does not treat chain / network errors as wrong passwords', () => {
    expect(isWrongPasswordError(new Error('Swap execution is unavailable'))).toBe(false);
    expect(isWrongPasswordError(new Error('insufficient funds'))).toBe(false);
  });
});

describe('shortAddr', () => {
  it('shortens 0x addresses and leaves labels whole', () => {
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddr('Set when the swap is built')).toBe('Set when the swap is built');
  });
});

describe('no inline session-password field on any on-chain screen', () => {
  it('no on-chain screen contains the old inline label', () => {
    const offenders = ONCHAIN_SCREENS.filter((f) => read(f).includes('Session password (to sign)'));
    expect(offenders).toEqual([]);
  });

  it('no on-chain screen prompts for the session password with Alert.alert', () => {
    const offenders = ONCHAIN_SCREENS.filter((f) => read(f).includes('Session password required'));
    expect(offenders).toEqual([]);
  });

  it('no on-chain screen keeps a page-level password state for signing', () => {
    // The modal owns the only password state now; a screen holding its
    // own `password` useState for signing would be an inline field.
    const offenders = ONCHAIN_SCREENS.filter((f) => /const \[password, setPassword\]/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('every on-chain screen signs through the shared modal', () => {
  it('all four screens import and render SignTransactionModal', () => {
    for (const f of ONCHAIN_SCREENS) {
      const text = read(f);
      expect(text).toContain('SignTransactionModal');
      expect(text).toContain('<SignTransactionModal');
    }
  });

  it('all four screens hand the modal an onSign callback and an onSigned callback', () => {
    for (const f of ONCHAIN_SCREENS) {
      const text = read(f);
      expect(text).toContain('onSign=');
      expect(text).toContain('onSigned=');
    }
  });

  it('signing still goes through getSignerForChain, only inside the modal callbacks', () => {
    for (const f of ONCHAIN_SCREENS) {
      const text = read(f);
      expect(text).toContain('getSignerForChain(password,');
    }
  });
});

describe('SignTransactionModal guarantees', () => {
  const modal = () => read('components/SignTransactionModal.tsx');

  it('offers biometrics as an alternative to typing the password', () => {
    expect(modal()).toContain('Sign with biometrics instead');
    expect(modal()).toContain('readBiometricSessionPassword');
  });

  it('shows a wrong-password error inline and sends nothing', () => {
    expect(modal()).toContain('Wrong password — nothing was sent. Try again.');
  });

  it('closing cancels with nothing sent', () => {
    expect(modal()).toContain('Closing this sheet cancels — nothing is sent.');
  });

  it('shows success with the tx hash and an explorer link', () => {
    expect(modal()).toContain('Transaction sent');
    expect(modal()).toContain('View on explorer');
  });

  it('never calls the secret-export path and never renders a seed phrase', () => {
    expect(modal()).not.toContain('exportSecret');
    expect(modal()).not.toContain('mnemonic');
  });

  it('clears the password from state on close and on success', () => {
    const occurrences = modal().split("setPassword('')").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('unlock page is untouched', () => {
  it('src/app/unlock.tsx still exists and still handles the initial unlock', () => {
    expect(fs.existsSync(path.join(APP, 'unlock.tsx'))).toBe(true);
    expect(read('app/unlock.tsx')).toContain('Unlock Wallet');
  });
});
