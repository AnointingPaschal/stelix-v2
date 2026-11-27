/** Screen 4 — Import Wallet (v1 sheet layout as a full screen):
 *  Seed Phrase / Private Key toggle, Wallet Name, recovery phrase or key,
 *  new session password + confirm, Import & Secure button. Scam warning
 *  kept at the top.
 *
 *  Errors are shown INLINE on the page. Never use Alert.alert here:
 *  on react-native-web Alert.alert is an empty no-op, so a failure used
 *  to look like a silent dead button (2026-11-26 bug). */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme';
import { Btn, RiskNote, centeredContent } from '../components/ui';
import { hasWallet, importWallet, isValidMnemonic } from '../lib/wallet';
import { useApp } from '../store/AppContext';

type Method = 'seed' | 'key';

export default function ImportWallet() {
  const { setOnboarded, setUnlocked, setAddress } = useApp();
  const insets = useSafeAreaInsets();

  const [method, setMethod] = useState<Method>('seed');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Importing REPLACES the wallet stored on this device — there is no
  // multi-wallet support. The old screen never said so: a user tapping
  // "Add / Import Wallet" from Home could silently lose access to
  // their current wallet (recoverable only via its seed phrase).
  const [hasExistingWallet, setHasExistingWallet] = useState(false);
  useEffect(() => {
    void hasWallet().then(setHasExistingWallet);
  }, []);

  async function handleImport() {
    setError('');
    if (method === 'seed') {
      const words = secret.trim().split(/\s+/);
      if (words.length < 12 || !isValidMnemonic(secret)) {
        setError('Invalid seed phrase — check every word and the order, then try again.');
        return;
      }
    } else if (secret.trim().length < 32) {
      setError('Invalid private key — paste the full private key (with or without 0x).');
      return;
    }
    if (password.length < 8) {
      setError('Password too short — use at least 8 characters for your app password.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match — re-type the same session password in both fields.');
      return;
    }
    setBusy(true);
    try {
      const address = await importWallet(secret, password, name);
      setAddress(address);
      setOnboarded(true);
      setUnlocked(true);
      router.replace('/(tabs)');
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : 'That seed phrase or private key could not be used. Check it and try again.'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
        <Text style={styles.title}>Import Wallet</Text>
        <Text style={styles.sub}>Name your wallet, select your import method, and provide the credentials.</Text>
        <Text style={styles.warn}>
          Only import a phrase you wrote down yourself. Never import a phrase sent to you by “support”, a website, or
          a stranger — it is a scam and your funds will be stolen.
        </Text>
        {hasExistingWallet ? (
          <Text style={styles.warn}>
            A wallet already exists on this device. Importing replaces it — make sure you have saved the current
            wallet&apos;s seed phrase first, or you will lose access to it.
          </Text>
        ) : null}

        <View style={styles.toggle}>
          <Btn label="Seed Phrase" variant={method === 'seed' ? 'primary' : 'ghost'} onPress={() => setMethod('seed')} style={styles.toggleBtn} />
          <Btn label="Private Key" variant={method === 'key' ? 'primary' : 'ghost'} onPress={() => setMethod('key')} style={styles.toggleBtn} />
        </View>

        <Text style={styles.label}>Wallet Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Wallet Name (e.g. Vault)"
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.label}>{method === 'seed' ? 'Recovery Phrase' : 'Private Key'}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={method === 'seed' ? 'Enter your 12 or 24-word Recovery Phrase…' : 'Enter your private key (0x…)…'}
          value={secret}
          onChangeText={setSecret}
        />
        <Text style={styles.label}>Set a new session password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          placeholder="At least 8 characters"
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
        <View style={styles.spacer} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Btn label="Import & Secure" onPress={handleImport} loading={busy} />
        <RiskNote />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  error: {
    backgroundColor: COLORS.redSoft,
    borderRadius: 12,
    color: COLORS.red,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
    padding: 10,
  },
  inner: { padding: 16 },
  input: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    fontSize: 14,
    marginTop: 6,
    padding: 12,
  },
  label: { color: COLORS.text, fontSize: 12, fontWeight: '700', marginTop: 14 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spacer: { height: 14 },
  sub: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  toggle: { backgroundColor: COLORS.bgMuted, borderRadius: 12, flexDirection: 'row', gap: 6, marginTop: 14, padding: 4 },
  toggleBtn: { flex: 1, minHeight: 36 },
  warn: {
    backgroundColor: COLORS.amberSoft,
    borderRadius: 12,
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    padding: 10,
  },
});
