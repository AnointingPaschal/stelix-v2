/** Screen 4 — Import Wallet: seed phrase or private key, with scam warnings. */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { Btn, DemoBadge, RiskNote } from '../components/ui';
import { importWallet, isValidMnemonic } from '../lib/wallet';
import { useApp } from '../store/AppContext';

export default function ImportWallet() {
  const { setOnboarded, setUnlocked, setAddress } = useApp();
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    const words = secret.trim().split(/\s+/);
    if (words.length >= 12 && !isValidMnemonic(secret)) {
      Alert.alert('Invalid seed phrase', 'Check every word and the order, then try again.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters for your app password.');
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
      <View style={styles.head}>
        <Text style={styles.title}>Import Wallet</Text>
        <DemoBadge />
      </View>
      <Text style={styles.warn}>
        Only import a phrase you wrote down yourself. Never import a phrase sent to you by “support”, a website, or
        a stranger — it is a scam and your funds will be stolen.
      </Text>
      <Text style={styles.label}>Seed phrase (12 / 24 words) or private key</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="word1 word2 word3 ..."
        value={secret}
        onChangeText={setSecret}
      />
      <Text style={styles.label}>New app password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="At least 8 characters"
        value={password}
        onChangeText={setPassword}
      />
      <View style={styles.spacer} />
      <Btn label="Import Wallet" onPress={handleImport} loading={busy} />
      <RiskNote />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 24 },
  input: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    fontSize: 16,
    marginTop: 8,
    padding: 14,
  },
  label: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 16 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spacer: { height: 16 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  warn: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    color: '#92400E',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 16,
    padding: 12,
  },
});
