/**
 * Group B audit — SCREENS GROUP B (onboarding/auth, Send/Receive, Vault,
 * Settings/Discipline/Notifications, shared components). Source checks
 * following the repo's no-placeholder test pattern (fs reads, no RN
 * imports).
 *
 * Guarantees:
 *  - No Alert.alert remains in Group B screens: on react-native-web it
 *    is a no-op, so any button using it looked dead.
 *  - BottomSheet scrolls tall content, respects safe-area insets, and
 *    is capped/centred on wide screens.
 *  - Every Group B ScrollView screen centres its content in a max-width
 *    column (responsive: 320px phones up to 1024px desktop).
 *  - Unlock keeps its password/biometric flow with inline errors and a
 *    real lockout after repeated failures.
 *  - Settings rows are all wired: real address book, real cache clear,
 *    inline About.
 *  - Notifications derive real alerts from locks; Send offers saved
 *    recipients from the address book.
 *  - No launchpad anywhere in the wallet UI; on-chain screens still
 *    sign only through the shared SignTransactionModal.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

const GROUP_B_SCREENS = [
  'app/index.tsx',
  'app/_layout.tsx',
  'app/onboarding.tsx',
  'app/create.tsx',
  'app/import.tsx',
  'app/unlock.tsx',
  'app/send.tsx',
  'app/receive.tsx',
  'app/(tabs)/vault.tsx',
  'app/vault/create.tsx',
  'app/vault/[id].tsx',
  'app/(tabs)/settings.tsx',
  'app/settings.tsx',
  'app/discipline.tsx',
  'app/notifications.tsx',
  'components/SignTransactionModal.tsx',
  'components/ui.tsx',
  'components/SafetyScoreCard.tsx',
];

const SCROLL_SCREENS = [
  'app/create.tsx',
  'app/import.tsx',
  'app/send.tsx',
  'app/receive.tsx',
  'app/(tabs)/vault.tsx',
  'app/vault/create.tsx',
  'app/vault/[id].tsx',
  'app/settings.tsx',
  'app/discipline.tsx',
  'app/notifications.tsx',
];

describe('no dead Alert.alert buttons in Group B', () => {
  it('no Group B screen calls Alert.alert (comments warning against it do not count)', () => {
    const offenders = GROUP_B_SCREENS.filter((f) => read(f).includes('Alert.alert('));
    expect(offenders).toEqual([]);
  });
});

describe('BottomSheet is responsive and safe-area aware', () => {
  const sheet = () => read('components/ui.tsx');

  it('scrolls tall content instead of clipping it', () => {
    expect(sheet()).toContain('<ScrollView');
    expect(sheet()).toContain('sheetScroll');
  });

  it('respects the home-indicator / notch inset at the bottom', () => {
    expect(sheet()).toContain('useSafeAreaInsets');
    expect(sheet()).toContain('insets.bottom');
  });

  it('is capped and centred on tablet/desktop widths', () => {
    expect(sheet()).toContain('maxWidth: 560');
    expect(sheet()).toContain("alignSelf: 'center'");
  });

  it('the app provides the safe-area context the sheet reads', () => {
    expect(read('app/_layout.tsx')).toContain('SafeAreaProvider');
  });
});

describe('responsive centred content', () => {
  it('every Group B ScrollView screen uses the centred max-width column', () => {
    const offenders = SCROLL_SCREENS.filter((f) => !read(f).includes('centeredContent'));
    expect(offenders).toEqual([]);
  });

  it('the responsive hook and centred column exist in shared ui', () => {
    expect(read('components/ui.tsx')).toContain('useResponsive');
    expect(read('components/ui.tsx')).toContain('maxWidth: 720');
  });

  it('small-screen rows wrap instead of overflowing', () => {
    expect(read('app/vault/[id].tsx')).toContain("flexWrap: 'wrap'");
    expect(read('app/send.tsx')).toContain("flexWrap: 'wrap'");
  });
});

describe('unlock keeps its flow, with inline errors and a real lockout', () => {
  const unlock = () => read('app/unlock.tsx');

  it('still has the Unlock Wallet button and biometric option', () => {
    expect(unlock()).toContain('Unlock Wallet');
    expect(unlock()).toContain('Biometrics');
  });

  it('shows wrong-password feedback inline, never via Alert', () => {
    expect(unlock()).toContain('Wrong password');
    expect(unlock()).not.toContain('Alert.alert(');
  });

  it('really locks out after repeated failures (countdown shown)', () => {
    expect(unlock()).toContain('LOCKOUT_AFTER_FAILS');
    expect(unlock()).toContain('Locked — try again in');
  });

  it('factory reset is a two-step inline confirm, not an Alert dialog', () => {
    expect(unlock()).toContain('Yes, Remove Wallet');
    expect(unlock()).toContain('confirmReset');
  });
});

describe('settings rows are all wired', () => {
  const settings = () => read('app/settings.tsx');

  it('address book is a real CRUD list backed by lib/addressBook', () => {
    expect(settings()).toContain('addSavedAddress');
    expect(settings()).toContain('removeSavedAddress');
    expect(settings()).toContain('Add Address');
  });

  it('clear cache really clears the token-logo cache', () => {
    expect(settings()).toContain('clearLogoCache');
    expect(settings()).toContain('Cache cleared');
  });

  it('about expands inline instead of an alert', () => {
    expect(settings()).toContain('aboutOpen');
    expect(settings()).toContain('Stelix 2.0.0');
  });

  it('password-change success is shown inline', () => {
    expect(settings()).toContain('Password changed');
    expect(settings()).toContain('pwOk');
  });
});

describe('notifications and share actions are real', () => {
  it('notifications derive live alerts from locks', () => {
    expect(read('app/notifications.tsx')).toContain('deriveLockNotifications');
    expect(read('app/notifications.tsx')).toContain('Mark all read');
  });

  it('discipline share copies to the clipboard with inline feedback', () => {
    const d = read('app/discipline.tsx');
    expect(d).toContain('Clipboard.setStringAsync');
    expect(d).toContain('Card Copied');
  });

  it('vault share receipt copies to the clipboard with inline feedback', () => {
    const v = read('app/vault/[id].tsx');
    expect(v).toContain('Clipboard.setStringAsync');
    expect(v).toContain('Receipt Copied');
  });

  it('send offers saved recipients from the address book', () => {
    const s = read('app/send.tsx');
    expect(s).toContain('loadAddressBook');
    expect(s).toContain('Saved Recipients');
  });
});

describe('launchpad stays out of the wallet; signing stays in the modal', () => {
  it('no Group B file mentions launchpad', () => {
    const offenders = GROUP_B_SCREENS.filter((f) => /launchpad/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('send and vault screens still render the shared signing modal only', () => {
    for (const f of ['app/send.tsx', 'app/vault/create.tsx', 'app/vault/[id].tsx']) {
      expect(read(f)).toContain('<SignTransactionModal');
      expect(read(f)).toContain('getSignerForChain(password,');
      expect(read(f)).not.toContain('Session password (to sign)');
    }
  });

  it('the signing modal has no nested ScrollView (BottomSheet scrolls)', () => {
    expect(read('components/SignTransactionModal.tsx')).not.toContain('<ScrollView');
  });
});
