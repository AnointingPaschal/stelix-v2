/** Screen 4 — Import Wallet (v1 sheet layout as a full screen):
 *  Seed Phrase / Private Key toggle, Wallet Name, recovery phrase or key,
 *  new session password + confirm, Import & Secure button. Scam warning
 *  kept at the top. */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { Btn, RiskNote } from '../components/ui';
import { importWallet, isValidMnemonic } from '../lib/wallet';
import { useApp } from '../store/AppContext';

type Method = 'seed' | 'key';

export default function ImportWallet() {
  const { setOnboarded, setUnlocked, setAddress } = useApp();
  const [method, setMethod] = useState<Method>('seed');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    if (method === 'seed') {
      const words = secret.trim().split(/\s+/);
      if (words.length < 12 || !isValidMnemonic(secret)) {
        Alert.alert('Invalid seed phrase', 'Check every word and the order, then try again.');
        return;
      }
    } else if (secret.trim().length < 32) {
      Alert.alert('Invalid private key', 'Paste the full private key (with or without 0x).');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters for your app password.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Re-type the same session password in both fields.');
      return;
    }
    setBusy(true);
    try {
      const address = await importWallet(secret, password);
      setAddress(address);
      setOnboarded(true);
      setUnlocked(true);
      router.replace('/(tabs)');
    } catch {
      Alert.alert('Import failed', 'That seed phrase or private key could not be used. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Import Wallet</Text>
      <Text style={styles.sub}>Name your wallet, select your import method, and provide the credentials.</Text>
      <Text style={styles.warn}>
        Only import a phrase you wrote down yourself. Never import a phrase sent to you by “support”, a website, or
        a stranger — it is a scam and your funds will be stolen.
      </Text>

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
      <Btn label="Import & Secure" onPress={handleImport} loading={busy} />
      <RiskNote />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
