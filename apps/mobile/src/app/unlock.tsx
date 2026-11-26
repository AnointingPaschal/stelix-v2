/** Screen 5 — Unlock / Welcome Back (v1): lock icon in a navy rounded
 *  square, "Welcome Back", PASSWORD label, password field, fingerprint,
 *  Unlock Wallet navy button, Factory Reset App red text. Password is
 *  verified against the encrypted key in SecureStore (see lib/wallet). */
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, Lock } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn } from '../components/ui';
import { unlockWallet, wipeWallet } from '../lib/wallet';
import { useApp } from '../store/AppContext';

export default function Unlock() {
  const { setUnlocked } = useApp();
  const [password, setPassword] = useState('');
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);

  async function unlockWithBiometrics() {
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Stelix' });
      if (res.success) {
        setUnlocked(true);
        router.replace('/(tabs)');
      }
    } catch {
      Alert.alert('Biometrics unavailable', 'Use your app password instead.');
    }
  }

  async function unlockWithPassword() {
    if (password.length < 8) {
      setFails((f) => f + 1);
      Alert.alert('Wrong password', 'Enter your session password to access your wallet.');
      return;
    }
    setBusy(true);
    try {
      const wallet = await unlockWallet(password);
      if (!wallet) {
        Alert.alert('No wallet on this device', 'Create or import a wallet first.');
        return;
      }
      setUnlocked(true);
      router.replace('/(tabs)');
    } catch {
      setFails((f) => f + 1);
      Alert.alert('Wrong password', 'Try again. After repeated failures, unlocking is delayed.');
    } finally {
      setBusy(false);
    }
  }

  function factoryReset() {
    Alert.alert(
      'Factory Reset App',
      'This removes the wallet from this device. Your seed phrase is the only recovery — Stelix cannot reset your password.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await wipeWallet();
            router.replace('/onboarding');
          },
        },
      ],
    );
  }

  return (
    <View style={styles.root}>
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
        onChangeText={setPassword}
        onSubmitEditing={unlockWithPassword}
      />
      {fails > 0 && (
        <Text style={styles.fails}>{fails} failed attempt{fails > 1 ? 's' : ''} — unlocking will be delayed after 5.</Text>
      )}

      <View style={styles.spacer} />
      <Pressable style={styles.bio} onPress={unlockWithBiometrics}>
        <Fingerprint size={28} color={COLORS.navy} />
        <Text style={styles.bioText}>Tap to unlock with Biometrics</Text>
      </Pressable>
      <Btn label="Unlock Wallet" onPress={unlockWithPassword} loading={busy} />
      <Pressable onPress={factoryReset} style={styles.reset}>
        <Text style={styles.resetText}>Factory Reset App</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bio: { alignItems: 'center', gap: 6, marginBottom: 16 },
  bioText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
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
  resetText: { color: COLORS.red, fontSize: 14, fontWeight: '700' },
  root: { backgroundColor: COLORS.bg, flex: 1, padding: 16, paddingTop: 48 },
  spacer: { flex: 1 },
  sub: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800', marginTop: 16 },
});
