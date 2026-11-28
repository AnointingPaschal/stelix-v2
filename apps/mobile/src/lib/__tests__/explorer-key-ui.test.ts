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

  it('never asks for an explorer API key — no key card, no Settings key prompt (keyless history, 2026-11-28)', () => {
    const text = src(HISTORY_SCREEN);
    expect(text).not.toContain('History needs an explorer API key');
    expect(text).not.toContain('Add key in Settings');
    expect(text).not.toContain('isNoExplorerKeyError');
    expect(text).not.toContain('etherscan.io');
    // A plain error line is still rendered for genuine load failures.
    expect(text).toContain('historyError ?');
  });

  it('keeps tx rows linking to the tx detail screen', () => {
    const text = src(HISTORY_SCREEN);
    expect(text).toContain("router.push({ pathname: '/tx/[hash]'");
  });
});

describe('Settings explorer API key field — REMOVED (keyless history, 2026-11-28)', () => {
  it('Settings no longer has an Explorer API key row, form, or key prompt', () => {
    const text = src(SETTINGS_SCREEN);
    expect(text).not.toContain('Explorer API key');
    expect(text).not.toContain('Save Key');
    expect(text).not.toContain('Clear Key');
    expect(text).not.toContain('EXPLORER_API_KEY_STORAGE_KEY');
    expect(text).not.toContain('etherscan.io');
  });

  it('renders AppHeader, and BottomNav only outside the tab group (no doubled nav in the tab)', () => {
    const text = src(SETTINGS_SCREEN);
    expect(text).toContain("import { AppHeader, BottomNav } from '../components/AppShell'");
    expect(text).toContain('<AppHeader showBack={!inTabs} />');
    expect(text).toContain('{!inTabs ? <BottomNav /> : null}');
    // The old usePathname().includes('(tabs)') check was always false
    // (usePathname never contains group segments); the fix uses segments.
    expect(text).toContain("useSegments().includes('(tabs)')");
  });
});
