import { isNewerVersion, parseVersion, shouldShowUpdate, UPDATE_THROTTLE_MS, type AppUpdate } from '../appUpdate';

const RELEASE: AppUpdate = { version: '2.1.0', notes: 'Faster locks.', url: 'https://example.com/stelix-2.1.0.apk', force: false };
const FORCED: AppUpdate = { ...RELEASE, force: true };

describe('parseVersion / isNewerVersion', () => {
  it('parses dotted versions numerically', () => {
    expect(parseVersion('2.1.0')).toEqual([2, 1, 0]);
    expect(parseVersion('10.0.1')).toEqual([10, 0, 1]);
  });

  it('a higher major/minor/patch is newer', () => {
    expect(isNewerVersion('2.0.0', '3.0.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '2.1.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '2.0.1')).toBe(true);
    expect(isNewerVersion('2.0.9', '2.0.10')).toBe(true);
  });

  it('equal versions are not newer, and a lower latest is not newer', () => {
    expect(isNewerVersion('2.1.0', '2.1.0')).toBe(false);
    expect(isNewerVersion('2.1.0', '2.0.9')).toBe(false);
    expect(isNewerVersion('2.1.0', '1.9.9')).toBe(false);
  });

  it('missing segments default to 0, and a pre-release suffix compares as its base version', () => {
    expect(isNewerVersion('2.1', '2.1.0')).toBe(false);
    expect(isNewerVersion('2.0.9', '2.1')).toBe(true);
    expect(isNewerVersion('2.0.0', '2.1.0-beta')).toBe(true);
  });
});

describe('shouldShowUpdate', () => {
  const NOW = 1_800_000_000_000;

  it('shows when newer and never shown', () => {
    expect(shouldShowUpdate('2.0.0', RELEASE, null, NOW)).toBe(true);
  });

  it('does not show when already on the latest version', () => {
    expect(shouldShowUpdate('2.1.0', RELEASE, null, NOW)).toBe(false);
    expect(shouldShowUpdate('2.2.0', RELEASE, null, NOW)).toBe(false);
  });

  it('does not show when there is no release', () => {
    expect(shouldShowUpdate('2.0.0', null, null, NOW)).toBe(false);
  });

  it('throttles a dismissible release to once per 24h', () => {
    expect(shouldShowUpdate('2.0.0', RELEASE, NOW - UPDATE_THROTTLE_MS + 1000, NOW)).toBe(false);
    expect(shouldShowUpdate('2.0.0', RELEASE, NOW - UPDATE_THROTTLE_MS, NOW)).toBe(true);
    expect(shouldShowUpdate('2.0.0', RELEASE, NOW - UPDATE_THROTTLE_MS - 1000, NOW)).toBe(true);
  });

  it('a forced release ignores the throttle', () => {
    expect(shouldShowUpdate('2.0.0', FORCED, NOW, NOW)).toBe(true);
    expect(shouldShowUpdate('2.0.0', FORCED, NOW - 1000, NOW)).toBe(true);
  });
});
