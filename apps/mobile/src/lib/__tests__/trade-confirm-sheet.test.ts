/**
 * Trade tab + TradeConfirmSheet — Discover tab replaced by Trade, and
 * the trade confirm sheet authenticates fingerprint-first.
 *
 * Source checks, following the signing-modal / appshell test pattern
 * (Jest here is node-only for pure logic, so presence/behaviour is
 * pinned by reading the screen and component sources).
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');

function src(rel: string): string {
  return fs.readFileSync(path.join(MOBILE, rel), 'utf8');
}

const LAYOUT = 'src/app/(tabs)/_layout.tsx';
const SHELL = 'src/components/AppShell.tsx';
const SHEET = 'src/components/TradeConfirmSheet.tsx';

describe('Discover tab replaced by Trade', () => {
  it('the Discover screen file is gone', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'app', '(tabs)', 'discover.tsx'))).toBe(false);
  });

  it('the tab bar is exactly Home, Swap, Trade, History, Settings', () => {
    const text = src(LAYOUT);
    const titles = [...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Home', 'Swap', 'Trade', 'History', 'Settings']);
  });

  it('the tab bar has a Trade route and no Discover route', () => {
    const text = src(LAYOUT);
    expect(text).toContain('name="trade"');
    expect(text).not.toContain('name="discover"');
    expect(text).not.toContain("title: 'Discover'");
    expect(text).not.toContain('Compass');
  });

  it('AppShell BottomNav has the same 5 tabs with a Trade entry', () => {
    const text = src(SHELL);
    for (const label of ['Home', 'Swap', 'Trade', 'History', 'Settings']) {
      expect(text).toContain(`label: '${label}'`);
    }
    expect(text).toContain("route: '/(tabs)/trade'");
    expect(text).not.toContain("route: '/(tabs)/discover'");
    expect(text).not.toContain("label: 'Discover'");
    expect(text).not.toContain('Compass');
  });

  it('no in-app navigation still points at the Discover screen', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(p);
        } else if (/\.(tsx?)$/.test(entry.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (/(['"`])(?:\/\(tabs\)\/discover|\/discover)\1/.test(text)) {
            offenders.push(path.relative(MOBILE, p));
          }
        }
      }
    };
    walk(path.join(MOBILE, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('Discover data layer stays (it is not the tab)', () => {
  it('src/lib/discover.ts still exists and import-token still uses it', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', 'discover.ts'))).toBe(true);
    expect(src('src/app/import-token.tsx')).toContain('searchTokens');
    expect(src('src/app/import-token.tsx')).toMatch(/from '\.\.\/lib\/discover'/);
  });
});

describe('TradeConfirmSheet contract', () => {
  it('exports TradeConfirmSheet with exactly the agreed props', () => {
    const text = src(SHEET);
    expect(text).toContain('export function TradeConfirmSheet');
    expect(text).toContain('export type TradeConfirmSheetProps');
    expect(text).toContain("import type { Signer } from 'ethers'");
    for (const prop of [
      'visible: boolean',
      'summary: { title: string; lines: { label: string; value: string }[] } | null',
      'confirmLabel: string',
      'onClose: () => void',
      'onSubmitted: (result: unknown) => void',
      'onError: (message: string) => void',
      'onConfirm: (signer: Signer) => Promise<unknown>',
    ]) {
      expect(text).toContain(prop);
    }
  });

  it('renders the summary title + label/value lines and the confirm label', () => {
    const text = src(SHEET);
    expect(text).toContain('summary?.title');
    expect(text).toContain('summary.lines.map');
    expect(text).toContain('confirmLabel');
  });
});

describe('TradeConfirmSheet auth flow (fingerprint-first, like SignTransactionModal)', () => {
  it('review phase shows NO auth UI — no password field, fingerprint button or secure note before the confirm tap', () => {
    const text = src(SHEET);
    expect(text).not.toContain('LocalAuthentication.authenticateAsync');
    expect(text).not.toContain('Sign with biometrics instead');
    // The password field only exists behind the authVisible gate, which
    // flips on only after the confirm button is tapped.
    expect(text).toContain('{authVisible ? (');
    expect(text).toContain('setAuthVisible(true)');
    expect(text).toContain('placeholder="Session password"');
  });

  it('confirm tap uses ONE biometric prompt: the SecureStore read IS the scanner — no separate authenticateAsync() call', () => {
    const text = src(SHEET);
    expect(text).toContain('handleConfirmPress');
    expect(text).toContain('LocalAuthentication.hasHardwareAsync');
    expect(text).toContain('LocalAuthentication.isEnrolledAsync');
    expect(text).toContain('readBiometricSessionPassword()');
    // No explicit scanner call — it used to run back-to-back with the
    // SecureStore prompt, giving the user two fingerprint prompts.
    expect(text).not.toContain('LocalAuthentication.authenticateAsync');
  });

  it('a missing stored biometric password, a failed/cancelled scan, or biometrics off reveals the password field — never a dead-end error', () => {
    const text = src(SHEET);
    // Biometric read returning null falls through to the password field.
    expect(text).toMatch(/const stored = await readBiometricSessionPassword\(\);[\s\S]*?setAuthVisible\(true\)/);
    // Biometrics off / unavailable: password field directly.
    expect(text).toMatch(/\/\/ Biometrics off or unavailable on this device: password field\.\n\s+setAuthVisible\(true\)/);
  });

  it('a typed-password confirm saves the password behind biometrics for next time; a biometric confirm does not re-save it', () => {
    const text = src(SHEET);
    expect(text).toContain('saveBiometricSessionPassword(passwordValue)');
    expect(text).toContain('if (biometricsEnabled && !viaBiometrics)');
  });

  it('the signer comes from decrypting the stored wallet with the password — never a stored key', () => {
    const text = src(SHEET);
    expect(text).toContain('unlockWallet(passwordValue)');
    expect(text).toContain('onConfirm(wallet)');
    expect(text).not.toContain('privateKey');
    expect(text).not.toContain('mnemonic');
  });

  it('success calls onSubmitted, failure calls onError with a short friendly message — never a raw dump', () => {
    const text = src(SHEET);
    expect(text).toContain('onSubmitted(result)');
    expect(text).toContain('onError(message)');
    expect(text).toContain("Wrong password — nothing was sent. Try again.");
    expect(text).toContain('friendlyError');
    expect(text).not.toContain('JSON.stringify');
  });

  it('closing the sheet cancels and clears the password — nothing is sent', () => {
    const text = src(SHEET);
    expect(text).toMatch(/function close\(\) \{[\s\S]*?setPassword\(''\);[\s\S]*?onClose\(\);/);
    expect(text).toContain('if (busy || bioBusy) return; // never dismiss mid-confirm');
  });

  it('the sheet says nothing about vaults, admin, sync or infrastructure', () => {
    const text = src(SHEET);
    // Word-boundary matches: "async" in the code must not trip "sync".
    expect(text).not.toMatch(/\bvault/i);
    expect(text).not.toMatch(/\badmin\b/i);
    expect(text).not.toMatch(/\bsync\b/i);
    expect(text).not.toMatch(/infrastructure/i);
  });
});
