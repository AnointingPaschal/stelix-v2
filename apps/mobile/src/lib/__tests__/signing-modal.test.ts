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
  'app/token/[symbol].tsx',
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

  it('review phase shows NO auth UI — no password field, label, hint, biometric button or secure note before the action tap', () => {
    const src = modal();
    expect(src).not.toContain('>Authenticate to sign<');
    expect(src).not.toContain('authLabel');
    expect(src).not.toContain('Your password decrypts the wallet on this device');
    expect(src).not.toContain('Sign with biometrics instead');
    expect(src).not.toContain('Closing this sheet cancels — nothing is sent.');
    // The password field only exists behind the authVisible gate, which
    // flips on only after the action button is tapped.
    expect(src).toContain('{authVisible ? (');
    expect(src).toContain('setAuthVisible(true)');
  });

  it('tapping the action button uses ONE biometric prompt: the SecureStore read IS the scanner — no separate authenticateAsync() call', () => {
    const src = modal();
    expect(src).toContain('handleActionPress');
    // Capability check only (no prompt): hardware + enrolment.
    expect(src).toContain('LocalAuthentication.hasHardwareAsync');
    expect(src).toContain('LocalAuthentication.isEnrolledAsync');
    // The single prompt: the biometric-gated SecureStore read.
    expect(src).toContain('readBiometricSessionPassword');
    expect(src).toContain('signWith(stored, true)');
    // No explicit scanner call — it used to run back-to-back with the
    // SecureStore prompt, giving the user two fingerprint prompts.
    expect(src).not.toContain('LocalAuthentication.authenticateAsync');
    expect(src).not.toContain('Authenticate to sign this transaction');
    // The action button drives the flow; there is no separate biometric
    // button any more.
    expect(src).not.toContain('signWithBiometrics');
  });

  it('a missing stored password or a failed/cancelled scan (read returns null) falls through to the password field — never a dead-end error', () => {
    const src = modal();
    expect(src).not.toContain('Biometrics unavailable or cancelled');
    expect(src).toContain('Enter your password once to enable fingerprint signing');
  });

  it('a typed-password sign saves the password behind biometrics for next time', () => {
    expect(modal()).toContain('saveBiometricSessionPassword(passwordValue)');
  });

  it('shows a wrong-password error inline and sends nothing', () => {
    expect(modal()).toContain('Wrong password — nothing was sent. Try again.');
  });

  it('closing cancels with nothing sent and cannot dismiss mid-send', () => {
    const src = modal();
    expect(src).toContain("if (phase === 'signing') return; // never dismiss mid-send");
    expect(src).toContain('onClose()');
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

  it('maintenance gate is unchanged — signing stays blocked with the admin message and a Close button', () => {
    const src = modal();
    expect(src).toContain('Maintenance is on — signing is paused. Nothing can be sent right now.');
    expect(src).toContain('Maintenance is on — signing is paused. Nothing was sent.');
  });

  it('a biometric sign does not re-save the already-stored password (no second biometric prompt)', () => {
    const src = modal();
    expect(src).toContain('signWith(stored, true)');
    expect(src).toContain('!viaBiometrics');
  });
});

describe('unlock page is untouched', () => {
  it('src/app/unlock.tsx still exists and still handles the initial unlock', () => {
    expect(fs.existsSync(path.join(APP, 'unlock.tsx'))).toBe(true);
    expect(read('app/unlock.tsx')).toContain('Unlock Wallet');
  });
});
