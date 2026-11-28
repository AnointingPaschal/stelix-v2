/**
 * Discover tab restored, Trade tab removed — the Trade screen and its
 * confirm sheet are gone; the bottom tabs are Home / Swap / Discover /
 * History / Settings again, with a BSC Alpha tab inside Discover.
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
const DISCOVER = 'src/app/(tabs)/discover.tsx';

describe('Discover tab restored, Trade tab removed', () => {
  it('the Discover screen file exists; the Trade screen and its sheet are gone', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'app', '(tabs)', 'discover.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'app', '(tabs)', 'trade.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'components', 'TradeConfirmSheet.tsx'))).toBe(false);
  });

  it('the tab bar is exactly Home, Swap, Discover, History, Settings', () => {
    const text = src(LAYOUT);
    const titles = [...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Home', 'Swap', 'Discover', 'History', 'Settings']);
  });

  it('the tab bar has a Discover route and no Trade route', () => {
    const text = src(LAYOUT);
    expect(text).toContain('name="discover"');
    expect(text).toContain("title: 'Discover'");
    expect(text).toContain('Compass');
    expect(text).not.toContain('name="trade"');
    expect(text).not.toContain("title: 'Trade'");
    expect(text).not.toContain('TrendingUp');
  });

  it('AppShell BottomNav has the same 5 tabs with a Discover entry', () => {
    const text = src(SHELL);
    for (const label of ['Home', 'Swap', 'Discover', 'History', 'Settings']) {
      expect(text).toContain(`label: '${label}'`);
    }
    expect(text).toContain("route: '/(tabs)/discover'");
    expect(text).not.toContain("route: '/(tabs)/trade'");
    expect(text).not.toContain("label: 'Trade'");
    expect(text).not.toContain('TrendingUp');
  });

  it('no in-app navigation still points at the Trade screen', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(p);
        } else if (/\.(tsx?)$/.test(entry.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (/(['"`])(?:\/\(tabs\)\/trade|\/trade)\1/.test(text)) {
            offenders.push(path.relative(MOBILE, p));
          }
        }
      }
    };
    walk(path.join(MOBILE, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('Discover data layer stays', () => {
  it('src/lib/discover.ts still exists and import-token still uses it', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', 'discover.ts'))).toBe(true);
    expect(src('src/app/import-token.tsx')).toContain('searchTokens');
    expect(src('src/app/import-token.tsx')).toMatch(/from '\.\.\/lib\/discover'/);
  });
});

describe('Discover fetches trending per network (Arc fix)', () => {
  it('lib/discover.ts queries trending_pools per network, never the global feed, capped at page 10', () => {
    const text = src('src/lib/discover.ts');
    expect(text).toContain('/networks/${encodeURIComponent(n)}/${endpoint}?page=${page}');
    expect(text).not.toContain('networks/trending_pools?page=');
    expect(text).toContain('GECKO_MAX_PAGE = 10');
  });

  it('the Discover screen shows skeleton rows while loading, not loading text', () => {
    const text = src(DISCOVER);
    expect(text).toContain('DiscoverSkeletonRows');
    expect(text).toContain("Skeleton } from '../../components/ui'");
    expect(text).not.toContain('Loading tokens…');
    expect(text).not.toContain('Loading more…');
  });

  it('the Discover screen uses the honest empty-state wording', () => {
    const text = src(DISCOVER);
    expect(text).toContain('No trending tokens on ${chainLabel} right now');
    expect(text).toContain('No new pairs on ${chainLabel} yet');
  });
});

describe('BSC Alpha tab', () => {
  it('the Discover screen has a BSC Alpha tab alongside Trending / Gainers / New Pairs', () => {
    const text = src(DISCOVER);
    expect(text).toContain("key: 'alpha'");
    expect(text).toContain("label: 'BSC Alpha'");
    expect(text).toContain('BSC Alpha');
    expect(text).not.toContain("label: 'Binance Alpha'");
    for (const label of ['Trending', 'Gainers', 'New Pairs']) {
      expect(text).toContain(label);
    }
  });

  it('Alpha rows never navigate (no chain or contract address in the feed) and the lib fetcher exists', () => {
    const text = src(DISCOVER);
    expect(text).toContain("t.address.startsWith('cmc:')");
    expect(src('src/lib/discover.ts')).toContain('fetchAlphaPage');
    expect(src('src/lib/discover.ts')).toContain('coinmarketcap');
    expect(src('src/lib/discover.ts')).toContain('tagSlugs=binance-alpha');
  });
});
