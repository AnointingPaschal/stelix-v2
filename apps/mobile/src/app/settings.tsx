/** Screen 17 — Advanced Settings (v1): centred title, grouped cards under
 *  SECURITY & BACKUP / NETWORK & WEB3 / APP PREFERENCES / SYSTEM, icon
 *  circles, chevron rows, red Wipe Wallet Environment button. Network
 *  picker lists all six chains with Arc first (default).
 *
 *  Every row does something real — no Alert.alert anywhere (it is a
 *  no-op on web, so the old Address Book / Clear Cache / About rows
 *  looked like dead buttons):
 *  - Address Book is a real saved-address list (see lib/addressBook.ts),
 *    also used by the Send screen's recipient picker.
 *  - Clear Cache really clears the token-logo cache (lib/tokenLogos.ts
 *    clearLogoCache) and confirms inline.
 *  - About expands inline. Password change / wipe confirm inline. */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bell,
  BookUser,
  ChevronRight,
  Copy,
  Fingerprint,
  Globe,
  Info,
  KeyRound,
  Lock,
  Paintbrush,
  Timer,
  Trash2,
  X,
} from 'lucide-react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { changePassword, clearBiometricSessionPassword, exportSecret, wipeWallet } from '../lib/wallet';
import {
  addSavedAddress,
  displaySavedAddress,
  loadAddressBook,
  removeSavedAddress,
  type SavedAddress,
} from '../lib/addressBook';
import { clearLogoCache } from '../lib/tokenLogos';
import * as Clipboard from 'expo-clipboard';
import { Btn, Card, NetworkSheet, RiskNote, centeredContent } from '../components/ui';

const AUTO_LOCK_OPTIONS = [0, 1, 5, 15];
const autoLockLabel = (m: number) => (m === 0 ? 'Immediately' : `${m} min`);

export default function Settings() {
  const { settings, updateSettings, chain, resetState } = useApp();
  const [netOpen, setNetOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [wipeMsg, setWipeMsg] = useState('');
  const [showWipe, setShowWipe] = useState(false);
  // Change password — wired to wallet.ts changePassword (decrypt with the
  // old password, re-encrypt under the new one). Wrong old password throws.
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwOk, setPwOk] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  // Export secrets — wired to wallet.ts exportSecret (password re-entry
  // required; the secret is shown once and never logged or stored).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPw, setExportPw] = useState('');
  const [exported, setExported] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  // Address book — real saved recipients (lib/addressBook.ts).
  const [bookOpen, setBookOpen] = useState(false);
  const [contacts, setContacts] = useState<SavedAddress[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [bookMsg, setBookMsg] = useState('');
  const [bookBusy, setBookBusy] = useState(false);
  // Clear cache / About — inline confirmation, no Alert.
  const [cacheMsg, setCacheMsg] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (bookOpen) void loadAddressBook().then(setContacts);
  }, [bookOpen]);

  async function submitPasswordChange() {
    if (newPw.length < 8) {
      setPwOk(false);
      setPwMsg('New password must be at least 8 characters.');
      return;
    }
    if (newPw !== newPw2) {
      setPwOk(false);
      setPwMsg('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    setPwMsg('');
    setPwOk(false);
    try {
      await changePassword(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setPwOk(true);
      setPwMsg('Password changed — your wallet is now encrypted under the new password.');
    } catch (e) {
      setPwOk(false);
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

  async function submitAddContact() {
    setBookBusy(true);
    setBookMsg('');
    try {
      const contact = await addSavedAddress(newLabel, newAddress);
      setContacts((prev) => [contact, ...prev]);
      setNewLabel('');
      setNewAddress('');
      setBookMsg(`Saved ${contact.label} — it now appears in Send.`);
    } catch (e) {
      setBookMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBookBusy(false);
    }
  }

  async function deleteContact(id: string) {
    setContacts(await removeSavedAddress(id));
  }

  function doClearCache() {
    clearLogoCache();
    setCacheMsg('Cache cleared — token logos will be re-fetched when needed.');
  }

  async function wipe() {
    if (wipeText.trim().toUpperCase() !== 'WIPE') {
      setWipeMsg('Type WIPE to confirm — wiping removes the wallet from this device. Your seed phrase is the only recovery.');
      return;
    }
    await wipeWallet();
    resetState();
    router.replace('/onboarding');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent]}>
      <Text style={styles.title}>Advanced Settings</Text>

      <Text style={styles.section}>SECURITY & BACKUP</Text>
      <Card style={styles.group}>
        <Row icon={<Fingerprint size={18} color={COLORS.text} />} title="Biometric Auth" sub="Require cryptographic signature via biometrics">
          <Switch
            value={settings.biometrics}
            onValueChange={(v) => {
              updateSettings({ biometrics: v });
              // Switching biometrics off wipes the biometric-gated copy
              // of the session password, so it can never sign again.
              if (!v) void clearBiometricSessionPassword();
            }}
            trackColor={{ true: COLORS.mint }}
          />
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
          {pwMsg ? <Text style={pwOk ? styles.formOk : styles.formErr}>{pwMsg}</Text> : null}
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
          sub={contacts.length > 0 ? `${contacts.length} saved address${contacts.length === 1 ? '' : 'es'}` : 'Manage saved wallet addresses'}
          onPress={() => setBookOpen((v) => !v)}
        />
        <Divider />
        <Row icon={<Bell size={18} color={COLORS.text} />} title="Notifications" sub="Targets, maturity and security alerts" onPress={() => router.push('/notifications')} />
        <Divider />
        <Row icon={<Paintbrush size={18} color={COLORS.text} />} title="Hide spam tokens" sub={settings.hideSpam ? 'On' : 'Off'}>
          <Switch value={settings.hideSpam} onValueChange={(v) => updateSettings({ hideSpam: v })} trackColor={{ true: COLORS.mint }} />
        </Row>
      </Card>

      {bookOpen ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Address book</Text>
          <Text style={styles.formHint}>Saved recipients appear in Send. Only real wallet addresses can be saved.</Text>
          {contacts.map((c) => (
            <View key={c.id} style={styles.contactRow}>
              <View style={styles.contactMid}>
                <Text style={styles.contactLabel}>{c.label}</Text>
                <Text style={styles.contactAddr}>{displaySavedAddress(c.address)}</Text>
              </View>
              <Pressable onPress={() => void Clipboard.setStringAsync(c.address)} hitSlop={8}>
                <Copy size={16} color={COLORS.textMuted} />
              </Pressable>
              <Pressable onPress={() => void deleteContact(c.id)} hitSlop={8}>
                <X size={16} color={COLORS.red} />
              </Pressable>
            </View>
          ))}
          {contacts.length === 0 ? <Text style={styles.formHint}>No saved addresses yet.</Text> : null}
          <TextInput style={styles.formInput} placeholder="Label (e.g. Mum)" value={newLabel} onChangeText={setNewLabel} autoCapitalize="words" />
          <TextInput style={styles.formInput} placeholder="Wallet address (0x… or Solana)" value={newAddress} onChangeText={setNewAddress} autoCapitalize="none" autoCorrect={false} />
          {bookMsg ? <Text style={styles.formErr}>{bookMsg}</Text> : null}
          <Btn label={bookBusy ? 'Saving…' : 'Add Address'} onPress={() => void submitAddContact()} disabled={bookBusy || !newLabel.trim() || !newAddress.trim()} />
        </Card>
      ) : null}

      <Text style={styles.section}>SYSTEM</Text>
      <Card style={styles.group}>
        <Row
          icon={<Trash2 size={18} color={COLORS.text} />}
          title="Clear Cache"
          sub="Free up application cache"
          onPress={doClearCache}
        />
        <Divider />
        <Row icon={<Info size={18} color={COLORS.text} />} title="About Stelix" sub="Version 2.0.0" onPress={() => setAboutOpen((v) => !v)} />
      </Card>

      {cacheMsg ? <Text style={styles.inlineOk}>{cacheMsg}</Text> : null}
      {aboutOpen ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>About Stelix</Text>
          <Text style={styles.formHint}>
            Stelix 2.0.0 · Non-custodial multichain vault wallet. Arc default · BNB · Base · Ethereum · Polygon ·
            Solana. Your keys never leave this device; locks are enforced on-chain by the StelixVault contract.
          </Text>
        </Card>
      ) : null}

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
            {wipeMsg ? <Text style={styles.formErr}>{wipeMsg}</Text> : null}
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
  contactAddr: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  contactLabel: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  contactMid: { flex: 1 },
  contactRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12, paddingVertical: 8 },
  divider: { backgroundColor: COLORS.border, height: 1, marginLeft: 52 },
  formBtn: { marginTop: 10 },
  formCard: { gap: 10, marginTop: 10 },
  formErr: { color: COLORS.red, fontSize: 12, lineHeight: 17 },
  formHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  formInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 14, padding: 12 },
  formOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  formTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  group: { paddingVertical: 4 },
  inner: { padding: 12 },
  inlineOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 10, textAlign: 'center' },
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
  rowMid: { flex: 1, minWidth: 0 },
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
