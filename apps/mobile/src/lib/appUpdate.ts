/**
 * App update prompt — pure version compare + throttle decision, plus the
 * async running-version read.
 *
 * The wallet learns about a newer build from the admin sync payload
 * (`appUpdate`, the latest published release). The prompt says only that
 * a new version of Stelix is available — it never mentions the admin,
 * the sync, or how the release was published.
 *
 * Throttle: a dismissible update shows at most once per 24h per device
 * (last-shown time in kv storage, key below). A forced update ignores
 * the throttle — it shows on every sync until the user updates.
 */
import { withTimeout } from './timeout';

/** One published release, as served in /api/sync `appUpdate`. */
export interface AppUpdate {
  version: string;
  notes: string | null;
  url: string | null;
  /** Users cannot dismiss the prompt while this is true. */
  force: boolean;
}

/** kv key for the last time a dismissible update prompt was shown. */
export const UPDATE_LAST_SHOWN_KEY = 'stelix_update_last_shown_v1';

/** Dismissible prompts re-appear at most once per 24h. */
export const UPDATE_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** Running version when expo-constants cannot be read (web / tests). */
export const FALLBACK_APP_VERSION = '2.0.0';

/** "2.1.0" -> [2, 1, 0]. Non-numeric segments (e.g. a "-beta" suffix)
 *  are treated as 0, so "2.1.0-beta" compares as 2.1.0. */
export function parseVersion(v: string): number[] {
  return v.split('.').map((p) => {
    const n = Number(p.replace(/[^0-9].*$/, ''));
    return Number.isFinite(n) ? n : 0;
  });
}

/** True when `latest` is strictly newer than `running`. Equal versions
 *  are not newer. */
export function isNewerVersion(running: string, latest: string): boolean {
  const a = parseVersion(running);
  const b = parseVersion(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

/**
 * Pure prompt decision, unit-tested.
 *
 * - No release, or the running version is already new enough: never.
 * - Forced release: always (the throttle does not apply).
 * - Otherwise: show when never shown, or when the last show was at
 *   least 24h ago.
 */
export function shouldShowUpdate(
  runningVersion: string,
  latest: AppUpdate | null,
  lastShownAtMs: number | null,
  nowMs = Date.now(),
): boolean {
  if (!latest) return false;
  if (!isNewerVersion(runningVersion, latest.version)) return false;
  if (latest.force) return true;
  if (lastShownAtMs === null) return true;
  return nowMs - lastShownAtMs >= UPDATE_THROTTLE_MS;
}

/** Running app version from expo-constants (dynamic import — the native
 *  module must never be statically imported into a Jest / web-safe
 *  module; see lib/circle.ts). Falls back to the package version when
 *  the module cannot be read. Cached per launch. Never throws. */
let runningVersionCache: string | undefined;
export async function getRunningVersion(): Promise<string> {
  if (runningVersionCache !== undefined) return runningVersionCache;
  try {
    const mod = await withTimeout(
      import('expo-constants'),
      10_000,
      'expo-constants dynamic import',
    );
    const v = (mod as unknown as { default?: { expoConfig?: { version?: unknown } } })
      .default?.expoConfig?.version;
    runningVersionCache = typeof v === 'string' && v.trim() !== '' ? v.trim() : FALLBACK_APP_VERSION;
  } catch {
    runningVersionCache = FALLBACK_APP_VERSION;
  }
  return runningVersionCache;
}

/** Test escape hatch for the running-version cache. */
export function clearRunningVersionCache(): void {
  runningVersionCache = undefined;
}
