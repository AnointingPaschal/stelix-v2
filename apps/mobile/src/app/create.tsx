/** Screen 3 — Create Wallet (v1 "Secure Your Vault" sheet as a full screen):
 *  Wallet Name, app password + confirm, Generate Keys button. Then the
 *  seed-phrase backup screen with an explicit "I have saved my seed
 *  phrase" confirmation, then Home.
 *  Compact v1 sizes (18px title, 12px labels, 14px inputs).
 *
 *  Errors are shown INLINE on the page. Never use Alert.alert here:
 *  on react-native-web Alert.alert is an empty no-op, so a failure used
 *  to look like a silent dead button (2026-11-26 bug). */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn, Card, RiskNote, centeredContent } from '../components/ui';
import { useApp } from '../store/AppContext';

export default function CreateWallet() {
  const { setOnboarded, setUnlocked, refreshWallets } = useApp();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // When wallets already exist, the new wallet is ADDED alongside them
  // under the SAME app password — the screen asks for the current
  // password (verified before creating) instead of a new one.
  const [hasExisting, setHasExisting] = useState(false);
  useEffect(() => {
    void import('../lib/wallet').then((m) => m.hasWallet().then(setHasExisting));
  }, []);

  async function handleCreate() {
    setError('');
    if (password.length < 8) {
      setError('Password too short — use at least 8 characters for your app password.');
      return;
    }
    if (!hasExisting && password !== confirm) {
      setError('Passwords do not match — re-type the same password in both fields.');
      return;
    }
    setBusy(true);
    try {
      // Lazy-load the wallet module (ethers) only when keys are actually
      // generated — importing it at the top level made /create (and the
      // first-load bundle) slow to render.
      const { createWallet, verifySessionPassword } = await import('../lib/wallet');
      if (hasExisting && !(await verifySessionPassword(password))) {
        setError("That password doesn't unlock your current wallet — check it and try again.");
        return;
      }
      const { mnemonic: phrase } = await createWallet(password, name);
      setMnemonic(phrase.split(' '));
      await refreshWallets();
      setStep(1);
    } catch (e) {
      setError(`Could not create wallet: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    if (!saved) {
      setError('Confirm you have saved your seed phrase before continuing.');
      return;
    }
    setOnboarded(true);
    setUnlocked(true);
    router.replace('/(tabs)');
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
        <Text style={styles.title}>Secure Your Vault</Text>
        {step === 0 && (
          <>
            <Text style={styles.sub}>
              {hasExisting
                ? 'Name your wallet. It is added alongside your existing wallets and uses the same app password.'
                : 'Name your wallet and create a secure session password. This mathematically encrypts your private keys.'}
            </Text>
            <Text style={styles.label}>Wallet Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Wallet Name (e.g. Savings)"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            {hasExisting ? (
              <>
                <Text style={styles.label}>Your current app password</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  placeholder="Enter your current app password"
                  value={password}
                  onChangeText={setPassword}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>App password</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  placeholder="Enter a strong password (8+ chars)"
                  value={password}
                  onChangeText={setPassword}
                />
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  placeholder="Re-type your password"
                  value={confirm}
                  onChangeText={setConfirm}
                />
              </>
            )}
            <Text style={styles.hint}>
              This password unlocks the wallet. Stelix cannot reset it — recovery needs your seed phrase.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Btn label={busy ? 'Generating Keys…' : 'Generate Keys'} onPress={handleCreate} loading={busy} />
            <RiskNote />
          </>
        )}
        {step === 1 && (
          <>
            <Text style={styles.sub}>Write down your seed phrase</Text>
            <Card dark>
              <Text style={styles.seed}>{mnemonic.join('  ')}</Text>
            </Card>
            <Text style={styles.hint}>
              Never share these words. Anyone with them controls your funds. Stelix support will never ask for them.
            </Text>
            <Pressable
              style={styles.checkRow}
              onPress={() => {
                setSaved((v) => !v);
                setError('');
              }}
            >
              <View style={[styles.checkBox, saved && styles.checkBoxOn]}>
                {saved ? <Check size={14} color="#fff" /> : null}
              </View>
              <Text style={styles.checkLabel}>I have saved my seed phrase</Text>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Btn label="Continue to Wallet" onPress={finish} disabled={!saved} />
            <RiskNote />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  checkBox: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkBoxOn: { backgroundColor: COLORS.mint, borderColor: COLORS.mint },
  checkLabel: { color: COLORS.text, flex: 1, fontSize: 14, fontWeight: '600' },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 14, marginTop: 6 },
  error: {
    backgroundColor: COLORS.redSoft,
    borderRadius: 12,
    color: COLORS.red,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
    padding: 10,
  },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12, marginTop: 6 },
  inner: { padding: 16 },
  input: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    fontSize: 14,
    marginTop: 6,
    padding: 12,
  },
  label: { color: COLORS.text, fontSize: 12, fontWeight: '700', marginTop: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  seed: { color: '#fff', fontSize: 14, fontWeight: '600', lineHeight: 26 },
  sub: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
