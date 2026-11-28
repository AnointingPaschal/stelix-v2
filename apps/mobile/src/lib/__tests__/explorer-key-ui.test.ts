/**
 * Explorer API key UI — regression test for the History no-key hint and
 * the Settings key field (2026-11-28).
 *
 * Jest here is node-only for pure logic, so screen behaviour is pinned
 * by reading the screen sources, following the appshell.test.ts pattern.
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');

function src(rel: string): string {
  return fs.readFileSync(path.join(MOBILE, rel), 'utf8');
}

const HISTORY_SCREEN = 'src/app/(tabs)/history.tsx';
const SETTINGS_SCREEN = 'src/app/settings.tsx';

describe('History screen no-key hint', () => {
  it('renders AppHeader at the top', () => {
    const text = src(HISTORY_SCREEN);
    expect(text).toContain("import { AppHeader } from '../../components/AppShell'");
    expect(text).toContain('<AppHeader />');
  });

  it('shows a friendly inline hint with a Settings button instead of the bare red error when no key is set', () => {
    const text = src(HISTORY_SCREEN);
    expect(text).toContain('isNoExplorerKeyError(historyError)');
    expect(text).toContain('History needs an explorer API key');
    expect(text).toContain('etherscan.io');
    expect(text).toContain('Add key in Settings');
    expect(text).toContain("router.push('/(tabs)/settings')");
    // The red error text is only rendered for non-no-key failures.
    expect(text).toMatch(/isNoKey \? \([\s\S]*?\) : historyError \? \(/);
  });

  it('keeps tx rows linking to the tx detail screen', () => {
    const text = src(HISTORY_SCREEN);
    expect(text).toContain("router.push({ pathname: '/tx/[hash]'");
  });
});

describe('Settings explorer API key field', () => {
  it('has a secure input with Save/Clear persisted under the exact storage key', () => {
    const text = src(SETTINGS_SCREEN);
    expect(text).toContain('Explorer API key');
    expect(text).toContain('secureTextEntry');
    expect(text).toContain('kvSet(EXPLORER_API_KEY_STORAGE_KEY');
    expect(text).toContain('kvDelete(EXPLORER_API_KEY_STORAGE_KEY');
    expect(text).toContain("import { EXPLORER_API_KEY_STORAGE_KEY } from '../lib/history'");
    // The literal key lives in history.ts; the constant must be exactly this.
    expect(src('src/lib/history.ts')).toContain("EXPLORER_API_KEY_STORAGE_KEY = 'stelix_explorer_api_key_v1'");
    expect(text).toContain('Save Key');
    expect(text).toContain('Clear Key');
  });

  it('notes that a free etherscan.io key unlocks history on BNB, Base, Ethereum and Polygon', () => {
    const text = src(SETTINGS_SCREEN);
    expect(text).toContain('etherscan.io');
    expect(text).toMatch(/BNB, Base, Ethereum and Polygon/);
  });

  it('renders AppHeader, and BottomNav only outside the tab group (no doubled nav in the tab)', () => {
    const text = src(SETTINGS_SCREEN);
    expect(text).toContain("import { AppHeader, BottomNav } from '../components/AppShell'");
    expect(text).toContain('<AppHeader showBack={!inTabs} />');
    expect(text).toContain('{!inTabs ? <BottomNav /> : null}');
    expect(text).toContain("usePathname().includes('(tabs)')");
  });
});
