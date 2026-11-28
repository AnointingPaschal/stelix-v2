/**
 * AppShell audit — regression test for the shared AppHeader + BottomNav
 * (2026-11-28).
 *
 * Every screen renders the same header (wallet pill left, chain pill
 * right, exactly like Home's topRow) and the stack screens outside the
 * tab navigator also get the same 5-tab bottom nav. Source checks,
 * following the safe-area-audit / keyboard-ux pattern (Jest here is
 * node-only for pure logic, so presence/behaviour is pinned by reading
 * the screen and component sources).
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');
const COMPONENTS = path.join(MOBILE, 'src', 'components');
const APP = path.join(MOBILE, 'src', 'app');

function src(rel: string): string {
  return fs.readFileSync(path.join(MOBILE, rel), 'utf8');
}

const SHELL = 'src/components/AppShell.tsx';

/** Tab-group screens: AppHeader only (the native tab bar already shows). */
const TAB_SCREENS = ['src/app/(tabs)/swap.tsx', 'src/app/(tabs)/vault.tsx'];
/** Stack screens: AppHeader (showBack) + BottomNav. */
const STACK_SCREENS = [
  'src/app/send.tsx',
  'src/app/receive.tsx',
  'src/app/token/[symbol].tsx',
  'src/app/tx/[hash].tsx',
  'src/app/notifications.tsx',
  'src/app/wallet-setup.tsx',
];

describe('AppShell exports', () => {
  it('exports AppHeader and BottomNav under exactly those names', () => {
    const text = src(SHELL);
    expect(text).toMatch(/export function AppHeader\(\{ showBack \}: \{ showBack\?: boolean \}\)/);
    expect(text).toMatch(/export function BottomNav\(\)/);
  });

  it('AppHeader renders the wallet pill + chain pill and opens the existing NetworkSheet', () => {
    const text = src(SHELL);
    expect(text).toContain('NetworkSheet');
    expect(text).toContain('setNetOpen(true)');
    expect(text).toContain('shortAddress(address');
    expect(text).toContain("useApp()");
  });

  it('AppHeader builds the Wallets sheet from useApp + Clipboard copy of the active address', () => {
    const text = src(SHELL);
    expect(text).toMatch(/wallets, activeWalletId, switchWallet, removeWallet/);
    expect(text).toContain('Clipboard.setStringAsync(w.address)');
    expect(text).toContain('switchWallet(w.id)');
    expect(text).toContain('removeWallet(w.id)');
    expect(text).toContain("router.push('/wallet-setup')");
  });

  it('with showBack the header renders a back chevron that calls router.back()', () => {
    const text = src(SHELL);
    expect(text).toContain('ChevronLeft');
    expect(text).toMatch(/showBack \? \(/);
    expect(text).toContain('router.back()');
  });

  it('BottomNav has the same 5 tabs, icons, colours and height as the native tab bar', () => {
    const text = src(SHELL);
    for (const label of ['Home', 'Swap', 'Discover', 'History', 'Settings']) {
      expect(text).toContain(`label: '${label}'`);
    }
    for (const icon of ['Home', 'ArrowLeftRight', 'Compass', 'History', 'Settings as SettingsIcon']) {
      expect(text).toContain(icon);
    }
    expect(text).toMatch(/height:\s*60 \+ insets\.bottom/);
    expect(text).toMatch(/paddingBottom:\s*6 \+ insets\.bottom/);
    expect(text).toContain('COLORS.navy');
    expect(text).toContain('COLORS.textMuted');
    expect(text).toContain('usePathname()');
    expect(text).toContain("router.push(route)");
  });

  it('AppShell never mentions the admin, sync or infrastructure to the user', () => {
    const text = src(SHELL);
    expect(text).not.toMatch(/\badmin\b/i);
    expect(text).not.toMatch(/\bsync\b/i);
  });
});

describe('AppShell wrapping', () => {
  it.each([...TAB_SCREENS, ...STACK_SCREENS])('%s renders AppHeader', (file) => {
    expect(src(file)).toContain('<AppHeader');
  });

  it.each(TAB_SCREENS)('%s has AppHeader only — no BottomNav (native tab bar shows)', (file) => {
    expect(src(file)).not.toContain('BottomNav');
  });

  it.each(STACK_SCREENS)('%s renders AppHeader with showBack and BottomNav at the bottom', (file) => {
    const text = src(file);
    expect(text).toContain('<AppHeader showBack />');
    expect(text).toContain('<BottomNav />');
  });

  it('stack screens have no second back chevron of their own', () => {
    // ScreenHeader without onBack renders a spacer, not a chevron;
    // the token/tx heads lost their own back Pressable to AppHeader.
    for (const file of ['src/app/send.tsx', 'src/app/receive.tsx', 'src/app/wallet-setup.tsx']) {
      expect(src(file)).not.toContain('onBack={() => router.back()}');
    }
    expect(src('src/app/token/[symbol].tsx')).not.toContain('ChevronLeft');
    expect(src('src/app/tx/[hash].tsx')).not.toContain('ChevronLeft');
  });
});

describe('swap screen: chain switch + slippage pill', () => {
  it('has no own chain switch button or NetworkSheet — the header provides it', () => {
    const text = src('src/app/(tabs)/swap.tsx');
    expect(text).not.toContain('chainBtn');
    expect(text).not.toContain('NetworkSheet');
    expect(text).not.toContain('netOpen');
  });

  it('slippage is a readable pill chip, not the clipped 9px badge', () => {
    const text = src('src/app/(tabs)/swap.tsx');
    expect(text).not.toContain('slipBadge');
    expect(text).toContain('Slippage {slippage}%');
    expect(text).toContain('slipPill');
  });
});

describe('text removal in AppShell files', () => {
  it('no RiskNote render remains in the wrapped screens', () => {
    for (const file of [...TAB_SCREENS, ...STACK_SCREENS]) {
      expect(src(file)).not.toContain('RiskNote');
    }
  });

  it('swap has no execNote paragraph', () => {
    const text = src('src/app/(tabs)/swap.tsx');
    expect(text).not.toContain('execNote');
    expect(text).not.toContain('Executes on PancakeSwap V2');
  });

  it('send signModal request has no warning field (the form already shows the hint)', () => {
    const text = src('src/app/send.tsx');
    expect(text).not.toMatch(/warning:\s*'/);
    // The form hint itself stays.
    expect(text).toContain('New-address warning: always double-check the first and last characters.');
  });

  it('real error and empty states were kept, not removed with the RiskNotes', () => {
    expect(src('src/app/(tabs)/swap.tsx')).toContain('formError');
    expect(src('src/app/(tabs)/vault.tsx')).toContain('No locks yet');
    expect(src('src/app/send.tsx')).toContain('Nothing to send yet');
    expect(src('src/app/token/[symbol].tsx')).toContain('Token not found');
  });
});
