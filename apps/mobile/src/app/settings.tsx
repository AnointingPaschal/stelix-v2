/** Screen 17 — Advanced Settings (v1): centred title, grouped cards under
 *  SECURITY & BACKUP / NETWORK & WEB3 / APP PREFERENCES / SYSTEM, icon
 *  circles, chevron rows, red Wipe Wallet Environment button. Network
 *  picker lists all six chains with Arc first (default). */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bell,
  BookUser,
  ChevronRight,
  Fingerprint,
  Globe,
  Info,
  KeyRound,
  Lock,
  Paintbrush,
  Timer,
  Trash2,
} from 'lucide-react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { changePassword, exportSecret, wipeWallet } from '../lib/wallet';
import * as Clipboard from 'expo-clipboard';
import { Btn, Card, NetworkSheet, RiskNote } from '../components/ui';

const AUTO_LOCK_OPTIONS = [0, 1, 5, 15];
const autoLockLabel = (m: number) => (m === 0 ? 'Immediately' : `${m} min`);

export default function Settings() {
  const { settings, updateSettings, chain, resetDemo } = useApp();
  const [netOpen, setNetOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [showWipe, setShowWipe] = useState(false);
  // Change password — wired to wallet.ts changePassword (decrypt with the
  // old password, re-encrypt under the new one). Wrong old password throws.
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  // Export secrets — wired to wallet.ts exportSecret (password re-entry
  // required; the secret is shown once and never logged or stored).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPw, setExportPw] = useState('');
  const [exported, setExported] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  async function submitPasswordChange() {
    if (newPw.length < 8) {
      setPwMsg('New password must be at least 8 characters.');
      return;
    }
    if (newPw !== newPw2) {
      setPwMsg('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    setPwMsg('');
    try {
      await changePassword(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setPwOpen(false);
      Alert.alert('Password changed', 'Your wallet is now encrypted under the new password.');
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPwBusy(false);
    }
  }

  async function submitExport() {
    setExportBusy(true);
    setExportMsg('');
    try {
      const secret = await exportSecret(exportPw);
      setExported(secret);
      setExportPw('');
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }

  function cycleAutoLock() {
    const i = AUTO_LOCK_OPTIONS.indexOf(settings.autoLockMinutes);
    updateSettings({ autoLockMinutes: AUTO_LOCK_OPTIONS[(i + 1) % AUTO_LOCK_OPTIONS.length] });
  }

  async function wipe() {
    if (wipeText.trim().toUpperCase() !== 'WIPE') {
      Alert.alert('Type WIPE to confirm', 'Wiping removes the wallet from this device. Your seed phrase is the only recovery.');
      return;
    }
    await wipeWallet();
    resetDemo();
    router.replace('/onboarding');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Advanced Settings</Text>

      <Text style={styles.section}>SECURITY & BACKUP</Text>
      <Card style={styles.group}>
        <Row icon={<Fingerprint size={18} color={COLORS.text} />} title="Biometric Auth" sub="Require cryptographic signature via biometrics">
          <Switch value={settings.biometrics} onValueChange={(v) => updateSettings({ biometrics: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
        <Divider />
        <Row
          icon={<Timer size={18} color={COLORS.text} />}
          title="Auto-Lock Timer"
          sub={autoLockLabel(settings.autoLockMinutes)}
          onPress={cycleAutoLock}
        />
        <Divider />
        <Row
          icon={<Lock size={18} color={COLORS.text} />}
          title="Change Password"
          sub="Update transaction signature password"
          onPress={() => setPwOpen((v) => !v)}
        />
        <Divider />
        <Row
          icon={<KeyRound size={18} color={COLORS.text} />}
          title="Export Secrets"
          sub="Backup Seed Phrases & Private Keys"
          onPress={() => setExportOpen((v) => !v)}
        />
      </Card>

      {pwOpen ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Change password</Text>
          <TextInput style={styles.formInput} placeholder="Current password" secureTextEntry value={oldPw} onChangeText={setOldPw} autoCapitalize="none" />
          <TextInput style={styles.formInput} placeholder="New password (min 8 characters)" secureTextEntry value={newPw} onChangeText={setNewPw} autoCapitalize="none" />
          <TextInput style={styles.formInput} placeholder="Confirm new password" secureTextEntry value={newPw2} onChangeText={setNewPw2} autoCapitalize="none" />
          {pwMsg ? <Text style={styles.formErr}>{pwMsg}</Text> : null}
          <Btn label={pwBusy ? 'Changing…' : 'Change Password'} onPress={() => void submitPasswordChange()} disabled={pwBusy || !oldPw || !newPw || !newPw2} />
        </Card>
      ) : null}

      {exportOpen ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Export secrets</Text>
          <Text style={styles.formHint}>Your seed phrase or private key is shown once, after you re-enter your password. Never share it with anyone, including support.</Text>
          {exported ? (
            <>
              <Text style={styles.secret} selectable>{exported}</Text>
              <Btn
                label="Copy Secret"
                onPress={() => void Clipboard.setStringAsync(exported)}
                style={styles.formBtn}
              />
              <Btn label="Hide Secret" variant="ghost" onPress={() => setExported('')} />
            </>
          ) : (
            <>
              <TextInput style={styles.formInput} placeholder="Password" secureTextEntry value={exportPw} onChangeText={setExportPw} autoCapitalize="none" />
              {exportMsg ? <Text style={styles.formErr}>{exportMsg}</Text> : null}
              <Btn label={exportBusy ? 'Checking…' : 'Reveal Secret'} onPress={() => void submitExport()} disabled={exportBusy || !exportPw} />
            </>
          )}
        </Card>
      ) : null}

      <Text style={styles.section}>NETWORK & WEB3</Text>
      <Card style={styles.group}>
        <Row icon={<Globe size={18} color={COLORS.text} />} title="Active Network" sub={`${chain.name}${chain.testnet ? ' · Testnet' : ''}`} onPress={() => setNetOpen(true)} />
      </Card>

      <Text style={styles.section}>APP PREFERENCES</Text>
      <Card style={styles.group}>
        <Row
          icon={<BookUser size={18} color={COLORS.text} />}
          title="Address Book"
          sub="Manage saved wallet addresses"
          onPress={() => Alert.alert('Address Book', 'No saved addresses yet.')}
        />
        <Divider />
        <Row icon={<Bell size={18} color={COLORS.text} />} title="Notifications" sub="Targets, maturity and security alerts" onPress={() => router.push('/notifications')} />
        <Divider />
        <Row icon={<Paintbrush size={18} color={COLORS.text} />} title="Hide spam tokens" sub={settings.hideSpam ? 'On' : 'Off'}>
          <Switch value={settings.hideSpam} onValueChange={(v) => updateSettings({ hideSpam: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
      </Card>

      <Text style={styles.section}>SYSTEM</Text>
      <Card style={styles.group}>
        <Row
          icon={<Trash2 size={18} color={COLORS.text} />}
          title="Clear Cache"
          sub="Free up application cache"
          onPress={() => Alert.alert('Cache cleared', 'No cached price or token data was stored on this device.')}
        />
        <Divider />
        <Row icon={<Info size={18} color={COLORS.text} />} title="About Stelix" sub="Version 2.0.0" onPress={() => Alert.alert('About Stelix', 'Stelix 2.0.0 · Non-custodial multichain vault wallet. Arc default · BNB · Base · Ethereum · Polygon · Solana.')} />
      </Card>

      <View style={styles.wipeWrap}>
        {!showWipe ? (
          <Pressable style={styles.wipeBtn} onPress={() => setShowWipe(true)}>
            <Trash2 size={16} color={COLORS.red} />
            <Text style={styles.wipeText}>Wipe Wallet Environment</Text>
          </Pressable>
        ) : (
          <Card style={styles.wipeCard}>
            <Text style={styles.wipeHint}>Type WIPE to remove the wallet from this device. Recovery needs your seed phrase.</Text>
            <TextInput style={styles.wipeInput} placeholder="WIPE" autoCapitalize="characters" value={wipeText} onChangeText={setWipeText} />
            <Btn label="Confirm Wipe" variant="danger" onPress={wipe} />
          </Card>
        )}
      </View>
      <RiskNote />

      <NetworkSheet visible={netOpen} onClose={() => setNetOpen(false)} />
    </ScrollView>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function Row({
  icon,
  title,
  sub,
  onPress,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowMid}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      {children ?? (onPress ? <ChevronRight size={16} color={COLORS.textMuted} /> : null)}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

const styles = StyleSheet.create({
  divider: { backgroundColor: COLORS.border, height: 1, marginLeft: 52 },
  formBtn: { marginTop: 10 },
  formCard: { gap: 10, marginTop: 10 },
  formErr: { color: COLORS.red, fontSize: 12, lineHeight: 17 },
  formHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  formInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 14, padding: 12 },
  formTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  group: { paddingVertical: 4 },
  inner: { padding: 12 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 12 },
  rowIcon: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowMid: { flex: 1 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  rowTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  secret: { backgroundColor: COLORS.bgMuted, borderRadius: 12, color: COLORS.text, fontSize: 12, lineHeight: 18, padding: 12 },
  section: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 18 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  wipeBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.redSoft,
    borderColor: '#FECACA',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  wipeCard: { gap: 10 },
  wipeHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  wipeInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 14, padding: 12 },
  wipeText: { color: COLORS.red, fontSize: 14, fontWeight: '800' },
  wipeWrap: { marginTop: 18 },
});
