/**
 * Launchpad is admin-only: the wallet must contain no launchpad tab,
 * screen, route or link. The launchpad registry in lib/chains.ts stays
 * (it is the admin's data source), the admin Launchpad Manager stays,
 * and contracts/src/launchpad/ stays — only the wallet UI is gone.
 * Source checks, following the no-placeholder test pattern.
 */
import * as fs from 'fs';
import * as path from 'path';

const MOBILE = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(MOBILE, '..', '..');
const APP = path.join(MOBILE, 'src', 'app');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no launchpad in the wallet UI', () => {
  it('no launchpad screen file remains under src/app', () => {
    const offenders = walk(APP).filter((f) => /launchpad/i.test(path.basename(f)));
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(APP, 'launchpad'))).toBe(false);
  });

  it('no wallet screen links to a launchpad route', () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const text = fs.readFileSync(file, 'utf8');
      if (/\/launchpad/.test(text) || /name="launchpad"/.test(text) || /title: 'Launchpad'/.test(text)) {
        offenders.push(path.relative(MOBILE, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the bottom nav is exactly Home, Swap, Trade, History, Settings', () => {
    const layout = fs.readFileSync(path.join(APP, '(tabs)', '_layout.tsx'), 'utf8');
    const titles = [...layout.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Home', 'Swap', 'Trade', 'History', 'Settings']);
  });

  it('the mobile launchpad lib and its tests are gone', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', 'launchpad.ts'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', '__tests__', 'launchpad.test.ts'))).toBe(false);
  });
});

describe('launchpad still exists where it belongs', () => {
  it('the chains registry still lists the launchpad addresses for the admin', () => {
    const chains = fs.readFileSync(path.join(MOBILE, 'src', 'lib', 'chains.ts'), 'utf8');
    expect(chains).toContain('LAUNCHPAD_ADDRESSES');
  });

  it('the launchpad contracts are untouched', () => {
    const dir = path.join(REPO, 'contracts', 'src', 'launchpad');
    expect(fs.existsSync(path.join(dir, 'StelixLaunchpad.sol'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'StelixTokenFactory.sol'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'LaunchToken.sol'))).toBe(true);
  });

  it('the admin Launchpad Manager is untouched', () => {
    expect(fs.existsSync(path.join(REPO, 'apps', 'admin', 'src', 'pages', 'Launchpad.tsx'))).toBe(true);
  });
});
