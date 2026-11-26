/** Screen 5 — Unlock: biometrics first, password fallback, on every cold start. */
import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS } from '../theme';
import { Btn } from '../components/ui';
import { useApp } from '../store/AppContext';

export default function Unlock() {
  const { setUnlocked } = useApp();
  const [password, setPassword] = useState('');
  const [fails, setFails] = useState(0);

  async function unlockWithBiometrics() {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Stelix',
      });
      if (res.success) {
        setUnlocked(true);
        router.replace('/(tabs)');
      }
    } catch {
      Alert.alert('Biometrics unavailable', 'Use your app password instead.');
    }
  }

  function unlockWithPassword() {
    if (password.length < 8) {
      setFails((f) => f + 1);
      Alert.alert('Wrong password', 'Try again. After repeated failures, unlocking is delayed.');
      return;
    }
    // DEMO: any 8+ char password unlocks the demo wallet. Production verifies
    // against the encrypted key in SecureStore (see src/lib/wallet.ts).
    setUnlocked(true);
    router.replace('/(tabs)');
  }

  return (
    <View style={styles.root}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.sub}>Unlock Stelix to see your portfolio and vault.</Text>
      <Btn label="Unlock with Biometrics" onPress={unlockWithBiometrics} variant="mint" />
      <Text style={styles.or}>or use your password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="App password"
        value={password}
        onChangeText={setPassword}
      />
      <Btn label="Unlock" onPress={unlockWithPassword} />
      {fails > 0 && <Text style={styles.fails}>{fails} failed attempt{fails > 1 ? 's' : ''} — unlocking will be delayed after 5.</Text>}
      <Text style={styles.forgot}>
        Forgot your password? Recovery needs your seed phrase — Stelix cannot reset it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fails: { color: COLORS.red, fontSize: 13, marginTop: 12, textAlign: 'center' },
  forgot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 20, textAlign: 'center' },
  input: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 12,
    padding: 14,
  },
  logo: { borderRadius: 999, height: 84, width: 84 },
  or: { color: COLORS.textMuted, fontSize: 13, marginVertical: 16, textAlign: 'center' },
  root: { backgroundColor: COLORS.bg, flex: 1, justifyContent: 'center', padding: 24 },
  sub: { color: COLORS.textMuted, fontSize: 14, marginBottom: 28, marginTop: 6, textAlign: 'center' },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800', marginTop: 16, textAlign: 'center' },
});
