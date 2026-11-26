/** Screen 3 — Create Wallet: password, seed display, backup quiz,
 *  biometrics, Discipline PIN. Compact v1 sizes (18px title, 12px labels,
 *  14px inputs). */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS } from '../theme';
import { Btn, Card, RiskNote, SectionTitle } from '../components/ui';
import { createWallet } from '../lib/wallet';
import { useApp } from '../store/AppContext';

export default function CreateWallet() {
  const { setOnboarded, setUnlocked, setAddress } = useApp();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [quizAnswer, setQuizAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const quizIndex = 4; // ask for word #5

  async function handleCreate() {
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters for your app password.');
      return;
    }
    setBusy(true);
    try {
      const { mnemonic: phrase, address } = await createWallet(password);
      setMnemonic(phrase.split(' '));
      setAddress(address);
      setStep(1);
    } catch (e) {
      Alert.alert('Could not create wallet', String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (quizAnswer.trim().toLowerCase() !== mnemonic[quizIndex]) {
      Alert.alert('Not quite', `Word #${quizIndex + 1} does not match. Check your written backup and try again.`);
      return;
    }
    if (pin.length !== 6) {
      Alert.alert('Discipline PIN', 'Set a 6-digit Discipline PIN. It is required to create, break or change a lock.');
      return;
    }
    try {
      const enrolled = await LocalAuthentication.hasHardwareAsync();
      if (enrolled) await LocalAuthentication.authenticateAsync({ promptMessage: 'Enable biometrics for Stelix' });
    } catch {
      // Biometrics unavailable — password unlock still works.
    }
    setOnboarded(true);
    setUnlocked(true);
    router.replace('/(tabs)');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Create Wallet</Text>
      {step === 0 && (
        <>
          <Text style={styles.label}>App password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="At least 8 characters"
            value={password}
            onChangeText={setPassword}
          />
          <Text style={styles.hint}>
            This password unlocks the wallet. Stelix cannot reset it — recovery needs your seed phrase.
          </Text>
          <Btn label="Create Wallet" onPress={handleCreate} loading={busy} />
        </>
      )}
      {step === 1 && (
        <>
          <SectionTitle title="Write down your seed phrase" />
          <Card dark>
            <Text style={styles.seed}>{mnemonic.join('  ')}</Text>
          </Card>
          <Text style={styles.hint}>
            Never share these words. Anyone with them controls your funds. Stelix support will never ask for them.
          </Text>
          <Text style={styles.label}>Backup check — what is word #{quizIndex + 1}?</Text>
          <TextInput
            style={styles.input}
            placeholder="Type the word"
            autoCapitalize="none"
            value={quizAnswer}
            onChangeText={setQuizAnswer}
          />
          <Text style={styles.label}>Discipline PIN (6 digits)</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••"
            keyboardType="number-pad"
            maxLength={6}
            secureTextEntry
            value={pin}
            onChangeText={setPin}
          />
          <Text style={styles.hint}>
            The Discipline PIN is separate from your password and is required to create, break or change a lock —
            so a borrowed unlocked phone still cannot break your discipline.
          </Text>
          <Btn label="Finish Setup" onPress={finish} />
          <RiskNote />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
