/**
 * TradeConfirmSheet — the confirm sheet for Trade (Hyperliquid perps).
 *
 * Shows the trade summary (title + label/value lines) and a confirm
 * button. Auth mirrors components/SignTransactionModal.tsx exactly:
 *
 *   1. Review — summary only. NO auth UI at all until the confirm
 *      button is tapped: no password field, no fingerprint button.
 *   2. Auth, on tapping confirm — if biometrics are enabled in Settings
 *      and the device has enrolled biometrics, the password stored
 *      behind the biometric gate is read straight from the OS keychain
 *      (see lib/wallet.ts save/readBiometricSessionPassword). That
 *      SecureStore read itself prompts for the fingerprint — it IS the
 *      scanner, so there is exactly ONE biometric prompt and no separate
 *      authenticateAsync() call before it. If no password is stored yet
 *      (the keychain copy only exists after one successful password
 *      sign), or biometrics fail / are cancelled, the password field is
 *      revealed inline instead — never a dead-end error. When biometrics
 *      are off, the password field is revealed directly.
 *   3. Confirm — the password (typed or released by biometrics)
 *      decrypts the stored wallet into an ethers signer, which is handed
 *      to onConfirm; on success onSubmitted(result) is called. A wrong
 *      password sends nothing and shows an inline error. Closing the
 *      sheet cancels — nothing is sent.
 *
 * The sheet never shows the seed phrase or private key, and the password
 * is never stored (except the optional biometric-gated copy in the OS
 * keychain, see lib/wallet.ts), logged, or left in a field — it is
 * cleared from state on close and on success. It keeps the wallet's
 * inner workings out of what the user sees.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Signer } from 'ethers';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS } from '../theme';
import { BottomSheet, Btn } from './ui';
import { isWrongPasswordError, validateSignPassword } from '../lib/signing';
import {
  readBiometricSessionPassword,
  saveBiometricSessionPassword,
  unlockWallet,
} from '../lib/wallet';
import { useAppOptional } from '../store/AppContext';

export type TradeConfirmSheetProps = {
  visible: boolean;
  summary: { title: string; lines: { label: string; value: string }[] } | null;
  confirmLabel: string;
  onClose: () => void;
  onSubmitted: (result: unknown) => void;
  onError: (message: string) => void;
  onConfirm: (signer: Signer) => Promise<unknown>;
};

export function TradeConfirmSheet({
  visible,
  summary,
  confirmLabel,
  onClose,
  onSubmitted,
  onError,
  onConfirm,
}: TradeConfirmSheetProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // The password field stays hidden until the user taps the confirm
  // button — the review phase shows the trade summary only.
  const [authVisible, setAuthVisible] = useState(false);

  // Biometrics toggle lives in Settings (AppContext settings.biometrics),
  // exactly as the signing modal's callers pass it in.
  const appCtx = useAppOptional();
  const biometricsEnabled = appCtx?.settings?.biometrics ?? false;

  // Fresh state every time the sheet opens; password never lingers.
  useEffect(() => {
    if (visible) {
      setPassword('');
      setError('');
      setBusy(false);
      setBioBusy(false);
      setAuthVisible(false);
      if (biometricsEnabled) {
        void (async () => {
          try {
            const [hw, enrolled] = await Promise.all([
              LocalAuthentication.hasHardwareAsync(),
              LocalAuthentication.isEnrolledAsync(),
            ]);
            setBiometricsAvailable(hw && enrolled);
          } catch {
            setBiometricsAvailable(false);
          }
        })();
      } else {
        setBiometricsAvailable(false);
      }
    }
  }, [visible, biometricsEnabled]);

  function close() {
    if (busy || bioBusy) return; // never dismiss mid-confirm
    setPassword('');
    setError('');
    setAuthVisible(false);
    onClose();
  }

  /** Short, user-friendly failure message — never a raw error dump. */
  function friendlyError(e: unknown): string {
    if (isWrongPasswordError(e)) return 'Wrong password — nothing was sent. Try again.';
    if (e instanceof Error && e.message.trim() !== '') return e.message;
    return 'Something went wrong — nothing was sent. Try again.';
  }

  async function confirmWith(passwordValue: string, viaBiometrics = false) {
    const validation = validateSignPassword(passwordValue);
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const wallet = await unlockWallet(passwordValue);
      if (!wallet) throw new Error('No wallet stored on this device.');
      const result = await onConfirm(wallet);
      // A typed-password confirm stores the password behind the
      // biometric gate, so the next confirm can use the fingerprint
      // scanner. A biometric confirm skips this — the password is
      // already stored, and re-saving it would prompt for biometrics
      // a second time.
      if (biometricsEnabled && !viaBiometrics) void saveBiometricSessionPassword(passwordValue);
      setPassword('');
      setBusy(false);
      onSubmitted(result);
    } catch (e) {
      setBusy(false);
      // A stored password that no longer decrypts must still leave the
      // user somewhere useful: reveal the password field so the error
      // is visible and typing the password works.
      if (viaBiometrics) setAuthVisible(true);
      const message = friendlyError(e);
      setError(message);
      onError(message);
    }
  }

  /**
   * The confirm button's one job: get the user authenticated, then
   * confirm. Biometrics (enabled in Settings + enrolled on the device)
   * read the stored password straight from the OS keychain — that
   * SecureStore read prompts for the fingerprint itself, so it is the
   * single biometric prompt. A missing stored password, or a
   * failed/cancelled scan, falls through to the password field — never
   * a dead-end error.
   */
  async function handleConfirmPress() {
    if (!summary || busy || bioBusy) return;
    // Password field already revealed: confirm with it.
    if (authVisible) {
      await confirmWith(password);
      return;
    }
    if (biometricsEnabled && biometricsAvailable) {
      setBioBusy(true);
      try {
        // Single prompt: readBiometricSessionPassword()'s SecureStore
        // read (requireAuthentication) IS the fingerprint scanner — do
        // NOT call authenticateAsync() first, or the user sees two OS
        // fingerprint prompts back-to-back.
        const stored = await readBiometricSessionPassword();
        if (stored) {
          await confirmWith(stored, true);
          return;
        }
        // Nothing stored yet — the keychain copy only exists after one
        // successful password sign — or the scan was cancelled/failed
        // (read returns null): reveal the password field instead of a
        // dead-end error.
        setAuthVisible(true);
      } finally {
        setBioBusy(false);
      }
      return;
    }
    // Biometrics off or unavailable on this device: password field.
    setAuthVisible(true);
  }

  return (
    <BottomSheet visible={visible} onClose={close} title={summary?.title ?? 'Confirm Trade'}>
      <View>
        {summary
          ? summary.lines.map((line) => (
              <View key={line.label} style={styles.row}>
                <Text style={styles.rowLabel}>{line.label}</Text>
                <Text style={styles.rowValue}>{line.value}</Text>
              </View>
            ))
          : null}

        {authVisible ? (
          <>
            {/* Keyboard avoidance lives in BottomSheet (KeyboardAvoidingView
                + sheet shrinks by keyboard height + ScrollView scrolls to
                the end on keyboard show), so this input and the Confirm
                button below it stay above the keyboard. */}
            <TextInput
              style={styles.passwordInput}
              secureTextEntry
              placeholder="Session password"
              placeholderTextColor={COLORS.textMuted}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (error) setError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              editable={!busy}
              onSubmitEditing={() => void confirmWith(password)}
            />
            {biometricsEnabled && biometricsAvailable ? (
              <Text style={styles.enrollNote}>
                Enter your password once to enable fingerprint signing
              </Text>
            ) : null}
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Btn label="Cancel" variant="ghost" onPress={close} disabled={busy || bioBusy} style={styles.actionBtn} />
          <Btn
            label={bioBusy ? 'Waiting for biometrics…' : busy ? 'Confirming…' : confirmLabel}
            variant="primary"
            onPress={() => void handleConfirmPress()}
            disabled={busy || bioBusy || !summary}
            loading={busy}
            style={styles.actionBtn}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  enrollNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  error: { color: COLORS.red, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  passwordInput: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { color: COLORS.textMuted, fontSize: 12 },
  rowValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});
