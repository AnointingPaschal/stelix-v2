/**
 * SignTransactionModal — the ONE place any on-chain activity is signed.
 *
 * Used by Send, Swap, Create Lock, Claim Matured, Claim Triggered Stage,
 * Request Break and Execute Break. No screen in the wallet has an inline
 * "Session password (to sign)" field any more: the user fills the action
 * on the page, taps Review/Confirm, and this bottom sheet opens.
 *
 * Flow:
 *   1. Review — full confirmation: action, from address, to (recipient
 *      or contract), token + amount, live USD value, network + fee,
 *      slippage / min-receive where relevant, and a warning when
 *      anything is unusual.
 *   2. Authenticate INSIDE the modal only — session password field, or
 *      biometrics when enabled in Settings and available on the device
 *      (the password is released from the OS keychain only after a
 *      biometric check — see lib/wallet.ts save/readBiometricSessionPassword).
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
import { AlertTriangle, CheckCircle2, ExternalLink, Fingerprint, ShieldCheck } from 'lucide-react-native';
import { COLORS } from '../theme';
import { BottomSheet, Btn } from './ui';
import { isWrongPasswordError, shortAddr, validateSignPassword } from '../lib/signing';
import { readBiometricSessionPassword, saveBiometricSessionPassword } from '../lib/wallet';

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
}

type Phase = 'review' | 'signing' | 'success';

export function SignTransactionModal({
  visible,
  request,
  biometricsEnabled,
  onClose,
  onSign,
  onSigned,
}: SignTransactionModalProps) {
  const [phase, setPhase] = useState<Phase>('review');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SignTxResult | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  // Fresh state every time the modal opens; password never lingers.
  useEffect(() => {
    if (visible) {
      setPhase('review');
      setPassword('');
      setError('');
      setResult(null);
      setBioBusy(false);
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
    onClose();
  }

  async function signWith(passwordValue: string) {
    if (!request) return;
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
      // Remember the password behind the biometric gate so the next
      // signing can use biometrics instead of typing. Best-effort and
      // native-only; a failure here never blocks the success screen.
      if (biometricsEnabled) void saveBiometricSessionPassword(passwordValue);
      setPassword('');
      setResult(res);
      setPhase('success');
    } catch (e) {
      setPhase('review');
      setError(
        isWrongPasswordError(e)
          ? 'Wrong password — nothing was sent. Try again.'
          : e instanceof Error
            ? e.message
            : 'Signing failed — nothing was sent.',
      );
    }
  }

  async function signWithBiometrics() {
    setError('');
    setBioBusy(true);
    try {
      const stored = await readBiometricSessionPassword();
      if (!stored) {
        setError('Biometrics unavailable or cancelled — enter your session password instead.');
        return;
      }
      await signWith(stored);
    } finally {
      setBioBusy(false);
    }
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

            <Text style={styles.authLabel}>Authenticate to sign</Text>
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
              editable={phase !== 'signing'}
              onSubmitEditing={() => void signWith(password)}
            />
            <Text style={styles.authHint}>
              Your password decrypts the wallet on this device to sign once. It is never stored on this page.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {biometricsAvailable ? (
              <Pressable style={styles.bioBtn} onPress={() => void signWithBiometrics()} disabled={phase === 'signing' || bioBusy}>
                <Fingerprint size={18} color={COLORS.navy} />
                <Text style={styles.bioText}>{bioBusy ? 'Waiting for biometrics…' : 'Sign with biometrics instead'}</Text>
              </Pressable>
            ) : null}

            <View style={styles.actions}>
              <Btn label="Cancel" variant="ghost" onPress={close} disabled={phase === 'signing'} style={styles.actionBtn} />
              <Btn
                label={phase === 'signing' ? 'Signing…' : request.actionLabel}
                variant="primary"
                onPress={() => void signWith(password)}
                disabled={phase === 'signing'}
                loading={phase === 'signing'}
                style={styles.actionBtn}
              />
            </View>
            <View style={styles.secureNote}>
              <ShieldCheck size={14} color={COLORS.textMuted} />
              <Text style={styles.secureText}>Closing this sheet cancels — nothing is sent.</Text>
            </View>
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
  authHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  authLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 16 },
  bioBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
  },
  bioText: { color: COLORS.navy, fontSize: 13, fontWeight: '700' },
  doneBtn: { marginTop: 16, width: '100%' },
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
  secureNote: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 12 },
  secureText: { color: COLORS.textMuted, fontSize: 11 },
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
