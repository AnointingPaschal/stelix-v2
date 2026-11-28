/**
 * Safe-area audit — regression test for the SafeArea sweep (2026-11-26).
 *
 * Every screen, modal, sheet and tab in the wallet must clear the status
 * bar / notch at the top and the gesture bar at the bottom using REAL
 * useSafeAreaInsets values — never fixed pixel padding. The previous fix
 * (commit 81ec9da) covered Import, Create, Onboarding, Splash, Send,
 * Receive, Settings, Discipline, Notifications, Vault and the bottom nav;
 * this test pins the whole app so no screen regresses to rendering from
 * y=0 or under the gesture bar.
 *
 * Source checks, following the no-launchpad / no-placeholder test pattern
 * (no RN imports — Jest here is node-only for pure logic).
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');
const APP = path.join(MOBILE, 'src', 'app');
const COMPONENTS = path.join(MOBILE, 'src', 'components');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Route screens: every .tsx under src/app except layouts and the
 *  (tabs)/settings re-export, which is covered by ../settings. */
function screenFiles(): string[] {
  return walk(APP).filter(
    (f) =>
      !f.endsWith('_layout.tsx') &&
      path.relative(APP, f) !== path.join('(tabs)', 'settings.tsx'),
  );
}

describe('safe-area audit: every screen consumes real insets', () => {
  it.each(screenFiles())('%s imports useSafeAreaInsets and applies top + bottom insets', (file) => {
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain("useSafeAreaInsets } from 'react-native-safe-area-context'");
    expect(text).toContain('useSafeAreaInsets()');
    // Top: content starts below the status bar / notch, never at y=0.
    expect(text).toMatch(/paddingTop:\s*[\d]+ \+ insets\.top|paddingTop:\s*insets\.top/);
    // Bottom: content ends above the gesture bar.
    expect(text).toMatch(/paddingBottom:\s*[\d]+ \+ insets\.bottom|paddingBottom:\s*insets\.bottom/);
  });

  it('no screen uses a bare fixed paddingTop / paddingBottom >= 12px (static pixels, no insets)', () => {
    // A bare value is one followed by , or } — "12 + insets.top" is not
    // bare. Small interior values (< 12, e.g. a row divider's paddingTop: 8)
    // are inside cards, not screen roots, so only screen-scale values count.
    // ui.tsx is excluded: its sheet's static 24 is overridden inline by
    // 24 + insets.bottom (pinned by the BottomSheet test above).
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = fs.readFileSync(file, 'utf8');
      const bare: string[] = [];
      for (const m of text.matchAll(/padding(?:Top|Bottom):\s*(\d+)\s*[,}]/g)) {
        if (Number(m[1]) >= 12) bare.push(m[0]);
      }
      if (bare.length > 0) offenders.push(`${path.relative(MOBILE, file)}: ${bare.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('(tabs)/settings is a pure re-export of the audited ../settings screen', () => {
    const text = fs.readFileSync(path.join(APP, '(tabs)', 'settings.tsx'), 'utf8');
    expect(text).toMatch(/export \{ default \} from '\.\.\/settings'/);
  });
});

describe('safe-area audit: chrome around the screens', () => {
  it('SafeAreaProvider wraps the root navigator', () => {
    const text = fs.readFileSync(path.join(APP, '_layout.tsx'), 'utf8');
    expect(text).toContain('<SafeAreaProvider>');
    expect(text).toContain('</SafeAreaProvider>');
  });

  it('the boot splash consumes insets (it renders before hydration)', () => {
    const text = fs.readFileSync(path.join(APP, '_layout.tsx'), 'utf8');
    expect(text).toMatch(/paddingTop:\s*insets\.top/);
    expect(text).toMatch(/paddingBottom:\s*insets\.bottom/);
    // Its absolute bottom line track sits above the gesture bar.
    expect(text).toMatch(/bottom:\s*48 \+ insets\.bottom/);
  });

  it('the bottom tab bar height and padding grow with insets.bottom', () => {
    const text = fs.readFileSync(path.join(APP, '(tabs)', '_layout.tsx'), 'utf8');
    expect(text).toMatch(/height:\s*60 \+ insets\.bottom/);
    expect(text).toMatch(/paddingBottom:\s*6 \+ insets\.bottom/);
  });

  it('the tab bar is exactly Home, Swap, Trade, History, Settings (no launchpad)', () => {
    const text = fs.readFileSync(path.join(APP, '(tabs)', '_layout.tsx'), 'utf8');
    const titles = [...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Home', 'Swap', 'Trade', 'History', 'Settings']);
  });
});

describe('safe-area audit: sheets and modals', () => {
  it('BottomSheet clears the gesture bar (paddingBottom includes insets.bottom)', () => {
    const text = fs.readFileSync(path.join(COMPONENTS, 'ui.tsx'), 'utf8');
    expect(text).toMatch(/paddingBottom:\s*24 \+ insets\.bottom/);
    // Capped height so the sheet top never reaches the status bar.
    expect(text).toMatch(/maxHeight:\s*'85%'/);
  });

  it('SignTransactionModal renders only through BottomSheet (no raw Modal of its own)', () => {
    const text = fs.readFileSync(path.join(COMPONENTS, 'SignTransactionModal.tsx'), 'utf8');
    expect(text).toContain('<BottomSheet');
    expect(text).not.toContain('<Modal');
    expect(text).not.toMatch(/import \{[^}]*\bModal\b[^}]*\} from 'react-native'/);
  });
});

describe('safe-area audit: 320px and 390px widths', () => {
  it('no screen or component sets a fixed width >= 320px (nothing clips on a 320px phone)', () => {
    const offenders: string[] = [];
    for (const file of [...walk(APP), ...walk(COMPONENTS)]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bwidth:\s*(\d+)/g)) {
        if (Number(m[1]) >= 320) offenders.push(`${path.relative(MOBILE, file)}: width ${m[1]}`);
      }
      for (const m of text.matchAll(/\bminWidth:\s*(\d+)/g)) {
        if (Number(m[1]) >= 320) offenders.push(`${path.relative(MOBILE, file)}: minWidth ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('screen content is capped and centred on wide screens, full-width on phones', () => {
    const text = fs.readFileSync(path.join(COMPONENTS, 'ui.tsx'), 'utf8');
    expect(text).toMatch(/maxWidth:\s*720/);
    expect(text).toContain("width: '100%'");
  });

  it('a small-phone breakpoint exists (< 360px) for the tightest rows', () => {
    const text = fs.readFileSync(path.join(COMPONENTS, 'ui.tsx'), 'utf8');
    expect(text).toMatch(/isSmallPhone:\s*width < 360/);
  });

  it('no screen anchors an absolute element to the screen bottom without insets.bottom', () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = fs.readFileSync(file, 'utf8');
      if (/\bbottom:\s*\d+/.test(text) && !text.includes('insets.bottom')) {
        offenders.push(path.relative(MOBILE, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('safe-area audit: route inventory (no orphan / launchpad screens)', () => {
  it('every router.push/replace target resolves to a real route file', () => {
    const routeFiles = new Set(
      walk(APP)
        .map((f) => path.relative(APP, f).replace(/\.tsx$/, '').replace(/\/index$/, '').replace(/^index$/, '(tabs)'))
        .map((r) => `/${r}`),
    );
    const targets = new Set<string>();
    for (const file of walk(APP)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/router\.(?:push|replace)\(\s*['"`]([^'"`]+)['"`]/g)) targets.add(m[1]);
      for (const m of text.matchAll(/router\.(?:push|replace)\(\{\s*pathname:\s*['"`]([^'"`]+)['"`]/g)) targets.add(m[1]);
    }
    const missing = [...targets]
      .filter((t) => !t.includes('${')) // dynamic segment, e.g. `/vault/${id}`
      .filter((t) => {
      if (t === '/(tabs)') return false; // group root = tabs index
      if (t.startsWith('/(tabs)/')) return !(routeFiles.has(t.replace('/(tabs)', '(tabs)')) || routeFiles.has(t));
      return !routeFiles.has(t);
    });
    expect(missing).toEqual([]);
    expect(targets.size).toBeGreaterThan(0);
  });

  it('no launchpad screen, tab or link remains in the wallet', () => {
    const offenders = walk(APP).filter((f) => /launchpad/i.test(path.basename(f)));
    expect(offenders).toEqual([]);
    for (const file of walk(APP)) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/\/launchpad|name="launchpad"|title: 'Launchpad'/);
    }
  });
});
