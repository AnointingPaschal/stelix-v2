/**
 * SignTransactionModal — the ONE place any on-chain activity is signed.
 *
 * Used by Send, Swap, Create Lock, Claim Matured, Claim Triggered Stage,
 * Request Break and Execute Break. No screen in the wallet has an inline
 * "Session password (to sign)" field any more: the user fills the action
 * on the page, taps Review/Confirm, and this bottom sheet opens.
 *
 * Flow:
 *   1. Review — full confirmation ONLY: action, from address, to
 *      (recipient or contract), token + amount, live USD value, network
 *      + fee, slippage / min-receive where relevant, and a warning when
 *      anything is unusual. No auth UI here — just Cancel and the action
 *      button (e.g. "Sign & Send").
 *   2. Auth, on tapping the action button — if biometrics are enabled in
 *      Settings and the device has enrolled biometrics, the password
 *      stored behind the biometric gate is read straight from the OS
 *      keychain (see lib/wallet.ts save/readBiometricSessionPassword).
 *      That SecureStore read itself prompts for the fingerprint — it IS
 *      the scanner, so there is exactly ONE biometric prompt and no
 *      separate authenticateAsync() call before it
 *      (the two used to run back-to-back). If no password is stored yet
 *      (the keychain copy only exists after one successful password
 *      sign), or biometrics fail / are cancelled, the password field is
 *      revealed inline instead — never a dead-end "Biometrics
 *      unavailable" error. Signing with the typed password saves it
 *      behind biometrics, so the next signing can use the scanner. When
 *      biometrics are off, the password field is revealed directly.
 *   3. Sign & Send — the transaction is signed and sent; the modal shows
 *      sending, then success with the tx hash + explorer link, or a clear
 *      error. A wrong password sends nothing and shows an inline error.
 *      Closing the modal cancels — nothing is sent.
 *
 * The modal never shows the seed phrase or private key, and the password
 * is never stored (except the optional biometric-gated copy in the OS
 * keychain, see lib/wallet.ts), logged, or left in a page field — it is
 * cleared from state on close and on success.
 */
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react-native';
import { COLORS } from '../theme';
import { BottomSheet, Btn } from './ui';
import { isWrongPasswordError, shortAddr, validateSignPassword } from '../lib/signing';
import { readBiometricSessionPassword, saveBiometricSessionPassword } from '../lib/wallet';
import { useAppOptional } from '../store/AppContext';

export interface SignTxRow {
  label: string;
  value: string;
  danger?: boolean;
}

export interface SignTxRequest {
  /** e.g. 'Confirm Swap', 'Confirm Send', 'Confirm Lock'. */
  title: string;
  /** e.g. 'Sign & Send Swap'. */
  actionLabel: string;
  fromAddress: string;
  /** Recipient address or contract address. */
  toAddress: string;
  /** What the To address is, e.g. 'Recipient' / 'PancakeSwap V2 router'. */
  toLabel: string;
  /** e.g. 'BNB Chain (testnet)'. */
  network: string;
  rows: SignTxRow[];
  warning?: string | null;
  /** Explorer base, e.g. 'https://bscscan.com' — tx link is base + /tx/<hash>. */
  explorerBase: string;
}

export interface SignTxResult {
  hash: string;
  blockNumber?: number | null;
  /** Lock id for Create Lock, so the caller can record the on-chain lock. */
  lockId?: number | null;
}

interface SignTransactionModalProps {
  visible: boolean;
  request: SignTxRequest | null;
  /** Settings → Biometric Auth toggle. */
  biometricsEnabled: boolean;
  onClose: () => void;
  /** Sign + send with the password the user typed (or released by
   *  biometrics). Must throw on a wrong password / failed send. */
  onSign: (password: string) => Promise<SignTxResult>;
  /** Called after a successful send so the caller can record the tx in
   *  History / update locks / refresh balances before success is shown. */
  onSigned: (result: SignTxResult) => void | Promise<void>;
  /** Maintenance override (tests / callers outside the provider). When
   *  omitted, the modal reads maintenance from AppContext. */
  signingBlocked?: boolean;
  maintenanceMessage?: string;
}

type Phase = 'review' | 'signing' | 'success';

export function SignTransactionModal({
  visible,
  request,
  biometricsEnabled,
  onClose,
  onSign,
  onSigned,
  signingBlocked: signingBlockedProp,
  maintenanceMessage: maintenanceMessageProp,
}: SignTransactionModalProps) {
  const [phase, setPhase] = useState<Phase>('review');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SignTxResult | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // The password field stays hidden until the user taps the action
  // button — the review phase shows the transaction summary only.
  const [authVisible, setAuthVisible] = useState(false);

  // Maintenance Mode: the ONE signing gate in the wallet. While the admin
  // has maintenance on, no transaction may be signed — the password form
  // and the Sign button are replaced by the admin's message. Props win
  // when given (tests); otherwise the live value from AppContext.
  const appCtx = useAppOptional();
  const signingBlocked = signingBlockedProp ?? appCtx?.signingBlocked ?? false;
  const maintenanceMessage = maintenanceMessageProp ?? appCtx?.maintenance.message ?? '';

  // Tell AppContext a transaction flow is open while this modal is
  // visible, so an admin network-mode flip is deferred until the flow
  // finishes or is cancelled — never mid-transaction.
  const setTxActive = appCtx?.setTransactionActive;
  useEffect(() => {
    setTxActive?.(visible);
    return () => {
      setTxActive?.(false);
    };
  }, [visible, setTxActive]);

  // Fresh state every time the modal opens; password never lingers.
  useEffect(() => {
    if (visible) {
      setPhase('review');
      setPassword('');
      setError('');
      setResult(null);
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
    if (phase === 'signing') return; // never dismiss mid-send
    setPassword('');
    setError('');
    setAuthVisible(false);
    onClose();
  }

  async function signWith(passwordValue: string, viaBiometrics = false) {
    if (!request) return;
    // Defence in depth: even if a caller opened the modal while
    // maintenance was off and it switched on mid-review, signing refuses.
    if (signingBlocked) {
      setError('Maintenance is on — signing is paused. Nothing was sent.');
      return;
    }
    const validation = validateSignPassword(passwordValue);
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setPhase('signing');
    try {
      const res = await onSign(passwordValue);
      await onSigned(res);
      // A typed-password sign stores the password behind the biometric
      // gate, so the next signing can use the fingerprint scanner. A
      // biometric sign skips this — the password is already stored, and
      // re-saving it would prompt for biometrics a second time.
      if (biometricsEnabled && !viaBiometrics) void saveBiometricSessionPassword(passwordValue);
      setPassword('');
      setResult(res);
      setPhase('success');
    } catch (e) {
      setPhase('review');
      // A stored password that no longer decrypts must still leave the
      // user somewhere useful: reveal the password field so the error is
      // visible and typing the password works.
      if (viaBiometrics) setAuthVisible(true);
      setError(
        isWrongPasswordError(e)
          ? 'Wrong password — nothing was sent. Try again.'
          : e instanceof Error
            ? e.message
            : 'Signing failed — nothing was sent.',
      );
    }
  }

  /**
   * The action button's one job: get the user authenticated, then sign.
   * Biometrics (enabled in Settings + enrolled on the device) read the
   * stored password straight from the OS keychain — that SecureStore
   * read prompts for the fingerprint itself, so it is the single
   * biometric prompt. A missing stored password, or a failed/cancelled
   * scan, falls through to the password field — never a dead-end error.
   */
  async function handleActionPress() {
    if (!request || phase === 'signing' || bioBusy) return;
    // Password field already revealed: the button signs with it.
    if (authVisible) {
      await signWith(password);
      return;
    }
    if (biometricsEnabled && biometricsAvailable) {
      setBioBusy(true);
      try {
        // Single prompt: readBiometricSessionPassword()'s SecureStore
        // read (requireAuthentication) IS the fingerprint scanner — do
        // NOT call authenticateAsync() first, or
        // the user sees two OS fingerprint prompts back-to-back.
        const stored = await readBiometricSessionPassword();
        if (stored) {
          await signWith(stored, true);
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
    <BottomSheet visible={visible} onClose={close} title={request?.title ?? 'Confirm Transaction'}>
      {/* No inner ScrollView: BottomSheet scrolls tall content itself, so
          the password field and buttons stay reachable on small phones. */}
      <View>
        {!request ? null : phase === 'success' && result ? (
          <View style={styles.successWrap}>
            <CheckCircle2 size={40} color={COLORS.mintDark} />
            <Text style={styles.successTitle}>Transaction sent</Text>
            <Text style={styles.successHash}>
              {result.hash.slice(0, 14)}…{result.hash.slice(-8)}
            </Text>
            {result.blockNumber !== null && result.blockNumber !== undefined ? (
              <Text style={styles.successSub}>Mined in block {result.blockNumber}</Text>
            ) : (
              <Text style={styles.successSub}>Recorded in History.</Text>
            )}
            <Pressable
              style={styles.explorerBtn}
              onPress={() => void Linking.openURL(`${request.explorerBase}/tx/${result.hash}`)}
            >
              <ExternalLink size={14} color={COLORS.navy} />
              <Text style={styles.explorerText}>View on explorer</Text>
            </Pressable>
            <Btn label="Done" onPress={close} style={styles.doneBtn} />
          </View>
        ) : (
          <>
            <View style={styles.addrCard}>
              <AddrRow label="From" value={shortAddr(request.fromAddress, 8)} />
              <AddrRow label={request.toLabel} value={shortAddr(request.toAddress, 8)} />
              <AddrRow label="Network" value={request.network} />
            </View>

            {request.rows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={[styles.rowValue, r.danger && styles.rowDanger]}>{r.value}</Text>
              </View>
            ))}

            {request.warning ? (
              <View style={styles.warnBox}>
                <AlertTriangle size={16} color="#B45309" />
                <Text style={styles.warnText}>{request.warning}</Text>
              </View>
            ) : null}

            {signingBlocked ? (
              <>
                <View style={styles.warnBox}>
                  <AlertTriangle size={16} color="#B45309" />
                  <Text style={styles.warnText}>
                    Maintenance is on — signing is paused. Nothing can be sent right now.
                    {maintenanceMessage !== '' ? ` ${maintenanceMessage}` : ''}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Btn label="Close" variant="ghost" onPress={close} style={styles.actionBtn} />
                </View>
              </>
            ) : (
              <>
                {authVisible ? (
                  <>
                    {/* Keyboard avoidance lives in BottomSheet (KeyboardAvoidingView
                        + sheet shrinks by keyboard height + ScrollView scrolls to
                        the end on keyboard show), so this input and the Sign button
                        below it stay above the keyboard. */}
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
                      editable={phase !== 'signing'}
                      onSubmitEditing={() => void signWith(password)}
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
                  <Btn label="Cancel" variant="ghost" onPress={close} disabled={phase === 'signing' || bioBusy} style={styles.actionBtn} />
                  <Btn
                    label={bioBusy ? 'Waiting for biometrics…' : phase === 'signing' ? 'Signing…' : request.actionLabel}
                    variant="primary"
                    onPress={() => void handleActionPress()}
                    disabled={phase === 'signing' || bioBusy}
                    loading={phase === 'signing'}
                    style={styles.actionBtn}
                  />
                </View>
              </>
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

function AddrRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.addrRow}>
      <Text style={styles.addrLabel}>{label}</Text>
      <Text style={styles.addrValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  addrCard: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    marginTop: 12,
    padding: 10,
  },
  addrLabel: { color: COLORS.textMuted, fontSize: 12 },
  addrRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  addrValue: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  doneBtn: { marginTop: 16, width: '100%' },
  enrollNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  error: { color: COLORS.red, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  explorerBtn: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 12 },
  explorerText: { color: COLORS.navy, fontSize: 13, fontWeight: '700' },
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
  rowDanger: { color: COLORS.red },
  rowLabel: { color: COLORS.textMuted, fontSize: 12 },
  rowValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  successHash: { color: COLORS.text, fontSize: 13, fontWeight: '700', marginTop: 8 },
  successSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  successTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: 10 },
  successWrap: { alignItems: 'center', paddingVertical: 16 },
  warnBox: {
    alignItems: 'center',
    backgroundColor: COLORS.amberSoft,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  warnText: { color: '#92400E', flex: 1, fontSize: 12, lineHeight: 17 },
});
