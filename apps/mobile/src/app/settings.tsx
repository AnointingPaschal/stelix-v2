/** Screen 17 — Settings / Advanced: security, networks, address book, preferences, wipe. */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { useApp, CHAINS } from '../store/AppContext';
import { Btn, Card, Chip, DemoBadge, RiskNote, SectionTitle } from '../components/ui';

export default function Settings() {
  const { settings, updateSettings, chain, setChain, resetDemo } = useApp();
  const [wipeText, setWipeText] = useState('');
  const [showWipe, setShowWipe] = useState(false);

  function wipe() {
    if (wipeText !== 'WIPE') {
      Alert.alert('Type WIPE to confirm', 'Wiping removes the wallet from this device. Your seed phrase is the only recovery.');
      return;
    }
    resetDemo();
    Alert.alert('Wallet wiped (DEMO)', 'Demo state was reset. Create or import a wallet to continue.');
    router.replace('/onboarding');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Settings</Text>
        <DemoBadge />
      </View>

      <SectionTitle title="Security" />
      <Card>
        <Row label="Biometric unlock" value={settings.biometrics}>
          <Switch value={settings.biometrics} onValueChange={(v) => updateSettings({ biometrics: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
        <Row label="Maturity reminders" value={settings.maturityReminders}>
          <Switch value={settings.maturityReminders} onValueChange={(v) => updateSettings({ maturityReminders: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
        <Row label="Hide spam tokens" value={settings.hideSpam}>
          <Switch value={settings.hideSpam} onValueChange={(v) => updateSettings({ hideSpam: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
        <Btn label="Change Password" variant="ghost" onPress={() => Alert.alert('Change password (DEMO)', 'Password change re-encrypts the key in SecureStore.')} />
        <Btn label="Export Secrets" variant="ghost" onPress={() => Alert.alert('Export secrets (DEMO)', 'Requires password + typed confirmation. Never share your seed phrase.')} />
      </Card>

      <SectionTitle title="Auto-lock timer" />
      <View style={styles.pills}>
        {[0, 1, 5, 15].map((m) => (
          <Btn
            key={m}
            label={m === 0 ? 'Immediately' : `${m} min`}
            variant={settings.autoLockMinutes === m ? 'primary' : 'ghost'}
            onPress={() => updateSettings({ autoLockMinutes: m })}
            style={styles.pill}
          />
        ))}
      </View>

      <SectionTitle title="Active Network" />
      <View style={styles.pills}>
        {CHAINS.map((c) => (
          <Btn key={c.id} label={`${c.name}${c.testnet ? ' (testnet)' : ''}`} variant={chain.id === c.id ? 'primary' : 'ghost'} onPress={() => setChain(c)} style={styles.pill} />
        ))}
      </View>
      <Text style={styles.hint}>Arc is the default chain. Solana uses a separate program with the same rules and UX.</Text>

      <SectionTitle title="Preferences" />
      <Card>
        <Row label="Currency" value>
          <Chip label={settings.currency} tone="navy" />
        </Row>
        <Row label="Language" value>
          <Chip label={settings.language} tone="navy" />
        </Row>
        <Btn label="Clear Cache" variant="ghost" onPress={() => Alert.alert('Cache cleared (DEMO)', 'Price and token metadata cache was cleared.')} />
      </Card>

      <SectionTitle title="About" />
      <Card>
        <Text style={styles.about}>Stelix 2.0.0 (DEMO build) · Expo SDK 58 · Non-custodial multichain vault wallet. Arc default · BNB · Base · Ethereum · Polygon · Solana.</Text>
        <Text style={styles.about}>Vault contracts: not deployed yet — testnet-first from the admin Contract Studio.</Text>
      </Card>

      <SectionTitle title="Danger Zone" />
      <Card>
        {!showWipe ? (
          <Btn label="Wipe Wallet" variant="danger" onPress={() => setShowWipe(true)} />
        ) : (
          <>
            <Text style={styles.hint}>Type WIPE to remove the wallet from this device. Recovery needs your seed phrase.</Text>
            <TextInput style={styles.input} placeholder="WIPE" autoCapitalize="characters" value={wipeText} onChangeText={setWipeText} />
            <Btn label="Confirm Wipe" variant="danger" onPress={wipe} />
          </>
        )}
      </Card>
      <RiskNote />
    </ScrollView>
  );
}

function Row({ label, children }: { label: string; value?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  about: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 20 },
  input: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 15, marginVertical: 10, padding: 14 },
  pill: { minHeight: 40, paddingHorizontal: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
});
