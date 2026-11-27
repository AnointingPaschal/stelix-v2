/**
 * Keyboard UX audit — regression test for the 2026-11-27 fixes:
 * (1) the Wallets sheet has ONE Import / Create wallet entry, opening
 *     a page with exactly two buttons (Create new / Import existing);
 * (2) the keyboard must never cover the input being typed in any modal,
 *     sheet or input screen; (3) the Import Token contract-address
 *     textbox must stay visible while typing.
 *
 * Source checks, following the safe-area-audit pattern (Jest here is
 * node-only for pure logic, so presence/behaviour is pinned by reading
 * the screen and component sources).
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');
const APP = path.join(MOBILE, 'src', 'app');
const COMPONENTS = path.join(MOBILE, 'src', 'components');

function src(rel: string): string {
  return fs.readFileSync(path.join(MOBILE, rel), 'utf8');
}

const INPUT_SCREENS = [
  'src/app/create.tsx',
  'src/app/import.tsx',
  'src/app/send.tsx',
  'src/app/(tabs)/swap.tsx',
  'src/app/settings.tsx',
  'src/app/unlock.tsx',
  'src/app/(tabs)/discover.tsx',
  'src/app/token/[symbol].tsx',
];

describe('keyboard UX: Wallets sheet has one Import / Create wallet entry', () => {
  it('Home Wallets sheet has a single "Import / Create wallet" row routing to /wallet-setup, and no Switch/Create rows', () => {
    const text = src('src/app/(tabs)/index.tsx');
    expect(text).toContain('Import / Create wallet');
    expect(text).toMatch(/router\.push\('\/wallet-setup'\)/);
    expect(text).not.toContain('Switch Wallet');
    expect(text).not.toContain('Create New Wallet');
  });

  it('the wallet-setup page has exactly two buttons: Create new wallet (-> /create) and Import existing wallet (-> /import)', () => {
    expect(fs.existsSync(path.join(APP, 'wallet-setup.tsx'))).toBe(true);
    const text = src('src/app/wallet-setup.tsx');
    expect(text).toContain('Create new wallet');
    expect(text).toMatch(/router\.push\('\/create'\)/);
    expect(text).toContain('Import existing wallet');
    expect(text).toMatch(/router\.push\('\/import'\)/);
  });

  it('both options carry the same add-alongside warning (nothing is replaced)', () => {
    const text = src('src/app/wallet-setup.tsx');
    expect(text).toMatch(/New wallets are added alongside your existing ones — nothing is replaced/);
    expect(text).toMatch(/back up its seed phrase first/);
  });

  it('/create is a real route with the full Create flow (not a shortcut)', () => {
    expect(fs.existsSync(path.join(APP, 'create.tsx'))).toBe(true);
    const text = src('src/app/create.tsx');
    expect(text).toContain('Generate Keys');
    expect(text).toContain('I have saved my seed phrase');
    expect(text).toContain('Continue to Wallet');
  });
});

describe('keyboard UX: BottomSheet lifts above the keyboard', () => {
  it('BottomSheet wraps its content in KeyboardAvoidingView', () => {
    const text = src('src/components/ui.tsx');
    expect(text).toContain('KeyboardAvoidingView');
    expect(text).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  });

  it('BottomSheet shrinks when the keyboard shows and scrolls to the end', () => {
    const text = src('src/components/ui.tsx');
    expect(text).toContain('keyboardDidShow');
    expect(text).toContain('keyboardDidHide');
    expect(text).toContain('scrollToEnd');
  });

  it('BottomSheet backdrop is still a sibling behind the sheet (taps inside a textbox never close it)', () => {
    const text = src('src/components/ui.tsx');
    expect(text).toContain('<Pressable style={StyleSheet.absoluteFill} onPress={onClose}');
    // The sheet View is a sibling after the backdrop Pressable, not inside it.
    const backdrop = text.indexOf('sheetBackdrop');
    const sheet = text.indexOf('styles.sheet,');
    expect(backdrop).toBeGreaterThan(-1);
    expect(sheet).toBeGreaterThan(backdrop);
  });

  it('SignTransactionModal password input uses the Go key to sign', () => {
    const text = src('src/components/SignTransactionModal.tsx');
    expect(text).toContain('returnKeyType="go"');
    expect(text).toContain('<BottomSheet');
  });
});

describe('keyboard UX: every input screen avoids the keyboard', () => {
  it.each(INPUT_SCREENS)('%s wraps its content in KeyboardAvoidingView', (rel) => {
    const text = src(rel);
    expect(text).toContain('KeyboardAvoidingView');
    expect(text).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  });

  // Unlock has no ScrollView (its root View is wrapped in KAV directly),
  // so there is nothing to put keyboardShouldPersistTaps on there.
  it.each(INPUT_SCREENS.filter((f) => f !== 'src/app/unlock.tsx'))(
    '%s keeps taps working while the keyboard is open',
    (rel) => {
      const text = src(rel);
      expect(text).toContain('keyboardShouldPersistTaps="handled"');
    },
  );
});

describe('keyboard UX: Import Token contract-address textbox stays visible', () => {
  it('the textbox dismisses the keyboard with Done and the button has room below it', () => {
    const text = src('src/app/(tabs)/index.tsx');
    expect(text).toContain('returnKeyType="done"');
    expect(text).toMatch(/importSubmit: \{ marginBottom: 16, marginTop: 12 \}/);
    expect(text).toContain('importBottomPad');
  });

  it('the preview card is still rendered in the sheet and reachable by scrolling', () => {
    const text = src('src/app/(tabs)/index.tsx');
    expect(text).toContain('previewCard');
    expect(text).toContain('Import Token');
  });
});
