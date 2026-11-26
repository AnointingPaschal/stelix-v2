/** Screen 5 — Unlock / Welcome Back (v1): lock icon in a navy rounded
 *  square, "Welcome Back", PASSWORD label, password field, fingerprint,
 *  Unlock Wallet navy button, Factory Reset App red text. Password is
 *  verified against the encrypted key in SecureStore (see lib/wallet).
 *
 *  Errors are shown INLINE on the page. Never use Alert.alert here:
 *  on react-native-web Alert.alert is an empty no-op, so a wrong password
 *  used to look like a silent dead button (same 2026-11-26 bug as
 *  create/import). Factory Reset is a two-step inline confirm for the
 *  same reason. After 5 failed attempts unlocking is really locked out
 *  for 30 seconds (countdown shown) — the old copy promised a delay
 *  that nothing enforced. */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, Lock } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn, centeredContent } from '../components/ui';
import { unlockWallet, wipeWallet } from '../lib/wallet';
import { kvDelete, kvGet, kvSet, wipeLocalData } from '../lib/storage';
import { useApp } from '../store/AppContext';

const LOCKOUT_AFTER_FAILS = 5;
const LOCKOUT_MS = 30_000;
/** Lockout state lives in durable kv storage (AsyncStorage on native,
 *  localStorage on web) — the old in-memory counter reset on every app
 *  restart, so the 5-failure lockout could be dodged by relaunching. */
const LOCKOUT_KEY = 'stelix_unlock_lockout_v1';

export default function Unlock() {
  const { setUnlocked, settings, resetState } = useApp();
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Biometrics are only offered when the Settings toggle is on AND the
  // device actually has enrolled biometrics. The old screen always
  // showed the button — even with biometrics off or on a device without
  // any enrolled fingerprint/face — and its success path never verified
  // anything about the wallet.
  const [bioAvailable, setBioAvailable] = useState(false);

  // Restore a lockout that was in force when the app closed.
  useEffect(() => {
    void kvGet(LOCKOUT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw) as { fails?: number; lockedUntil?: number };
        if (typeof p.fails === 'number') setFails(p.fails);
        if (typeof p.lockedUntil === 'number' && p.lockedUntil > Date.now()) {
          setLockedUntil(p.lockedUntil);
        }
      } catch {
        // Corrupt lockout state: start clean.
      }
    });
  }, []);

  useEffect(() => {
    // No synchronous setState here: when biometrics are off, the render
    // below gates the button on settings.biometrics anyway, so a stale
    // true from an earlier session never shows the button.
    if (!settings.biometrics) return;
    let cancelled = false;
    void (async () => {
      try {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!cancelled) setBioAvailable(hw && enrolled);
      } catch {
        if (!cancelled) setBioAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.biometrics]);

  const lockedOut = now < lockedUntil;
  const lockoutSecs = lockedOut ? Math.ceil((lockedUntil - now) / 1000) : 0;

  // Ticking clock only while locked out, so the countdown is live.
  useEffect(() => {
    if (!lockedOut) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedOut]);

  function persistLockout(nextFails: number, nextLockedUntil: number) {
    void kvSet(LOCKOUT_KEY, JSON.stringify({ fails: nextFails, lockedUntil: nextLockedUntil }));
  }

  function registerFail(message: string) {
    const next = fails + 1;
    setFails(next);
    if (next >= LOCKOUT_AFTER_FAILS) {
      const until = Date.now() + LOCKOUT_MS;
      setLockedUntil(until);
      setFails(0);
      persistLockout(0, until);
      setError(`Too many failed attempts — unlocking is locked for 30 seconds.`);
    } else {
      persistLockout(next, 0);
      setError(message);
    }
  }

  async function unlockWithBiometrics() {
    setError('');
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Stelix' });
      if (res.success) {
        setUnlocked(true);
        router.replace('/(tabs)');
      } else {
        setError('Biometrics cancelled — use your app password instead.');
      }
    } catch {
      setError('Biometrics unavailable on this device — use your app password instead.');
    }
  }

  async function unlockWithPassword() {
    if (lockedOut) return;
    if (password.length < 8) {
      registerFail('Wrong password — enter your session password to access your wallet.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const wallet = await unlockWallet(password);
      if (!wallet) {
        setError('No wallet on this device — create or import a wallet first.');
        return;
      }
      // A successful unlock clears the stored failure count.
      void kvDelete(LOCKOUT_KEY);
      setFails(0);
      setUnlocked(true);
      router.replace('/(tabs)');
    } catch {
      registerFail('Wrong password — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function factoryReset() {
    await wipeWallet();
    // The old reset wiped the wallet keys but left imported tokens,
    // the address book, watchlist and settings behind — and the app
    // context still believed a wallet was onboarded, so the splash
    // routed back to Unlock with no wallet at all.
    await wipeLocalData();
    resetState();
    router.replace('/onboarding');
  }

  return (
    <View style={[styles.root, centeredContent, { paddingTop: 48 + insets.top, paddingBottom: 16 + insets.bottom }]}>
      <View style={styles.lockBox}>
        <Lock size={28} color="#fff" />
      </View>
      <Text style={styles.title}>Welcome Back</Text>
      <Text style={styles.sub}>Enter your session password to access your decentralized wallet.</Text>

      <Text style={styles.label}>PASSWORD</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={COLORS.textMuted}
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (error) setError('');
        }}
        onSubmitEditing={unlockWithPassword}
        editable={!lockedOut && !busy}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {lockedOut ? (
        <Text style={styles.fails}>Locked — try again in {lockoutSecs}s.</Text>
      ) : fails > 0 ? (
        <Text style={styles.fails}>
          {fails} failed attempt{fails > 1 ? 's' : ''} — unlocking locks for 30 seconds after {LOCKOUT_AFTER_FAILS}.
        </Text>
      ) : null}

      <View style={styles.spacer} />
      {bioAvailable ? (
        <Pressable style={styles.bio} onPress={unlockWithBiometrics}>
          <Fingerprint size={28} color={COLORS.navy} />
          <Text style={styles.bioText}>Tap to unlock with Biometrics</Text>
        </Pressable>
      ) : null}
      <Btn label={lockedOut ? `Locked — ${lockoutSecs}s` : 'Unlock Wallet'} onPress={unlockWithPassword} loading={busy} disabled={lockedOut} />
      {confirmReset ? (
        <View style={styles.resetConfirm}>
          <Text style={styles.resetHint}>
            This removes the wallet from this device. Your seed phrase is the only recovery — Stelix cannot reset
            your password.
          </Text>
          <Btn label="Yes, Remove Wallet" variant="danger" onPress={() => void factoryReset()} />
          <Btn label="Cancel" variant="ghost" onPress={() => setConfirmReset(false)} style={styles.resetCancel} />
        </View>
      ) : (
        <Pressable onPress={() => setConfirmReset(true)} style={styles.reset}>
          <Text style={styles.resetText}>Factory Reset App</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bio: { alignItems: 'center', gap: 6, marginBottom: 16 },
  bioText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  error: {
    backgroundColor: COLORS.redSoft,
    borderRadius: 12,
    color: COLORS.red,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    padding: 10,
  },
  fails: { color: COLORS.red, fontSize: 12, marginTop: 8 },
  input: {
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  lockBox: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  reset: { alignItems: 'center', marginTop: 16 },
  resetCancel: { marginTop: 8 },
  resetConfirm: { gap: 4, marginTop: 16 },
  resetHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 8, textAlign: 'center' },
  resetText: { color: COLORS.red, fontSize: 14, fontWeight: '700' },
  root: { backgroundColor: COLORS.bg, flex: 1, padding: 16 },
  spacer: { flex: 1 },
  sub: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginTop: 16 },
});
