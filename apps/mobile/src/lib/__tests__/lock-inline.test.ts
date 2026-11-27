/**
 * Lock flow lives on the token detail screen (2026-11-27): there is no
 * separate lock wizard any more. The token's Create Discipline card
 * holds amount, duration, price target and exit plan; "Review & Lock"
 * opens the review sheet; confirming opens the shared signing modal.
 * The Vault tab's Create Lock just picks the token and opens its page.
 *
 * Guarantees (source checks, same pattern as the group audits):
 *  - No /vault/create route exists anywhere (file, layout, navigation).
 *  - The token detail screen renders the review sheet + signing modal
 *    and signs only through getSignerForChain + SignTransactionModal.
 *  - The Vault tab has no /vault/create navigation and opens a token
 *    picker instead.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

describe('lock flow is inline on the token detail screen', () => {
  it('the lock wizard route is gone: no file, no Stack.Screen, no navigation to it', () => {
    expect(fs.existsSync(path.join(SRC, 'app', 'vault', 'create.tsx'))).toBe(false);
    expect(read('app/_layout.tsx')).not.toContain('vault/create');
    for (const f of ['app/token/[symbol].tsx', 'app/(tabs)/vault.tsx']) {
      expect(read(f)).not.toContain('/vault/create');
    }
  });

  it('the token detail screen holds the whole lock flow: exit plan, review sheet, signing modal', () => {
    const t = read('app/token/[symbol].tsx');
    expect(t).toContain('Profit ladder');
    expect(t).toContain('Trailing stop');
    expect(t).toContain('Break mode');
    expect(t).toContain('Review your lock');
    expect(t).toContain('<BottomSheet');
    expect(t).toContain('<SignTransactionModal');
    expect(t).toContain('getSignerForChain(password,');
    expect(t).toContain('createLockOnChain(');
    expect(t).toContain('Review & Lock');
  });

  it('the Vault tab Create Lock opens a token picker that routes to the token detail screen', () => {
    const t = read('app/(tabs)/vault.tsx');
    expect(t).toContain('Choose a token to lock');
    expect(t).toContain('tokenDetailRoute(');
    expect(t).not.toContain('/vault/create');
  });
});
