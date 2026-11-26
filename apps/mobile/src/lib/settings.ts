/**
 * App settings — shape, storage key, defensive parsing.
 *
 * Settings live in durable kv storage (AsyncStorage on native,
 * localStorage on web) under SETTINGS_KEY, so a restart does not reset
 * the biometrics / auto-lock / spam / reminder toggles. This module is
 * deliberately free of React and react-native imports so it can be
 * unit-tested in Node; the store (AppContext) owns loading/persisting.
 */
export const SETTINGS_KEY = 'stelix_settings_v1';

export interface AppSettings {
  biometrics: boolean;
  autoLockMinutes: number; // 0 = immediately
  hideSpam: boolean;
  maturityReminders: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  biometrics: true,
  autoLockMinutes: 1,
  hideSpam: true,
  maturityReminders: true,
};

/** Parse stored settings defensively — a corrupt/partial blob falls back
 *  to defaults field by field, never crashes the launch. */
export function parseStoredSettings(raw: string | null): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const p = JSON.parse(raw) as Partial<AppSettings>;
    if (!p || typeof p !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      biometrics: typeof p.biometrics === 'boolean' ? p.biometrics : DEFAULT_SETTINGS.biometrics,
      autoLockMinutes:
        typeof p.autoLockMinutes === 'number' && [0, 1, 5, 15].includes(p.autoLockMinutes)
          ? p.autoLockMinutes
          : DEFAULT_SETTINGS.autoLockMinutes,
      hideSpam: typeof p.hideSpam === 'boolean' ? p.hideSpam : DEFAULT_SETTINGS.hideSpam,
      maturityReminders:
        typeof p.maturityReminders === 'boolean' ? p.maturityReminders : DEFAULT_SETTINGS.maturityReminders,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
