/** Screen 17 — Advanced Settings (v1): centred title, grouped cards under
 *  SECURITY & BACKUP / NETWORK & WEB3 / APP PREFERENCES / SYSTEM, icon
 *  circles, chevron rows, red Wipe Wallet Environment button. Network
 *  picker lists all six chains with Arc first (default).
 *
 *  Double-nav fix: this screen is both the Settings tab (re-exported by
 *  (tabs)/settings.tsx) and the /settings stack route. usePathname()
 *  returns the URL path WITHOUT group segments, so the old
 *  usePathname().includes('(tabs)') check was always false and BottomNav
 *  rendered in the tab too — two bottom nav bars stacked. useSegments()
 *  DOES include the '(tabs)' group, so inTabs is now true only in the
 *  tab: no BottomNav and no back chevron there; the stack route gets
 *  both. There is exactly one header on both routes (AppHeader; both
 *  navigators have headerShown: false).
 *
 *  Every detail/update opens as a half-screen BottomSheet modal (see
 *  components/ui.tsx), never as a separate screen and never as an
 *  inline expanding card: Auto-Lock Timer (OptionSheet), Change
 *  Password, Export Secrets, Address Book, Notifications, About.
 *  Biometric Auth stays an inline toggle; Clear Cache stays a one-tap
 *  action with an inline confirmation.
 *
 *  Every row does something real — no Alert.alert anywhere (it is a
 *  no-op on web):
 *  - Address Book is a real saved-address list (see lib/addressBook.ts),
 *    also used by the Send screen's recipient picker.
 *  - Clear Cache really clears the token-logo cache (lib/tokenLogos.ts
 *    clearLogoCache) and confirms inline.
 *  - About opens in a sheet. Password change / wipe confirm inline
 *    inside their sheet / card. */
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { wipeLocalData, kvGet, kvSet } from '../lib/storage';
import { deriveLockNotifications } from '../lib/notifications';
import { fmtDateTime } from '../lib/format';
import { AppHeader, BottomNav } from '../components/AppShell';
import * as Clipboard from 'expo-clipboard';
import { BottomSheet, Btn, Card, NetworkSheet, OptionSheet, RiskNote, centeredContent } from '../components/ui';

const AUTO_LOCK_OPTIONS = [0, 1, 5, 15];
const autoLockLabel = (m: number) => (m === 0 ? 'Immediately' : `${m} min`);

/** Same key as the Notifications screen: which derived alerts the user
 *  has marked read. */
const READ_DERIVED_KEY = 'stelix_read_derived_notifications_v1';

interface NotifRow {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

export default function Settings() {
  const { settings, updateSettings, chain, resetState, notifications, markNotificationsRead, locks, tokens } = useApp();
  const insets = useSafeAreaInsets();
  // This screen is both the Settings tab (re-exported by
  // (tabs)/settings.tsx) and the /settings stack route. useSegments
  // includes the '(tabs)' group segment; usePathname does not, so a
  // pathname check can never tell the two apart. In the tab the native
  // tab bar is already showing, so no back chevron and no BottomNav;
  // as a stack screen it gets both.
  const inTabs = useSegments().includes('(tabs)');

  const [netOpen, setNetOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [wipeMsg, setWipeMsg] = useState('');
  const [showWipe, setShowWipe] = useState(false);
  // Auto-lock timer — half-screen option sheet.
  const [autoLockOpen, setAutoLockOpen] = useState(false);
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
  // Notifications — half-screen sheet with the same stored + lock-derived
  // alerts as the Notifications screen (see lib/notifications.ts).
  const [notifOpen, setNotifOpen] = useState(false);
  const [readDerived, setReadDerived] = useState<string[]>([]);
  // Clear cache / About — inline confirmation / sheet, no Alert.
  const [cacheMsg, setCacheMsg] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (bookOpen) void loadAddressBook().then(setContacts);
  }, [bookOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    void kvGet(READ_DERIVED_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setReadDerived(parsed);
      } catch {
        // Corrupt read-state: start unread.
      }
    });
  }, [notifOpen]);

  const notifRows: NotifRow[] = useMemo(() => {
    if (!notifOpen) return [];
    const derived = deriveLockNotifications(
      locks,
      (symbol) => tokens.find((t) => t.symbol === symbol)?.price ?? null,
    ).filter((d) => settings.maturityReminders || d.kind !== 'maturity');
    const stored: NotifRow[] = notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      at: n.at,
      read: n.read,
    }));
    const live: NotifRow[] = derived.map((d) => ({
      id: d.id,
      title: d.title,
      body: d.body,
      at: d.at,
      read: readDerived.includes(d.id),
    }));
    return [...stored, ...live].sort((a, b) => b.at - a.at);
  }, [notifOpen, locks, tokens, settings.maturityReminders, notifications, readDerived]);

  const notifUnread = notifRows.filter((r) => !r.read).length;

  function markAllNotifRead() {
    markNotificationsRead();
    const derived = deriveLockNotifications(
      locks,
      (symbol) => tokens.find((t) => t.symbol === symbol)?.price ?? null,
    ).filter((d) => settings.maturityReminders || d.kind !== 'maturity');
    const next = Array.from(new Set([...readDerived, ...derived.map((d) => d.id)]));
    setReadDerived(next);
    void kvSet(READ_DERIVED_KEY, JSON.stringify(next));
  }

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
      setPwMsg('Password changed — all your wallets are now encrypted under the new password.');
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
      setWipeMsg('Type WIPE to confirm — wiping removes all wallets from this device. Your seed phrase is the only recovery.');
      return;
    }
    await wipeWallet();
    // Wiping the wallet alone left imported tokens, the address book,
    // watchlist and settings behind in local storage — wipe those too.
    await wipeLocalData();
    clearLogoCache();
    resetState();
    router.replace('/onboarding');
  }

  return (
    <View style={styles.shell}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
        <AppHeader showBack={!inTabs} />
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
            onPress={() => setAutoLockOpen(true)}
          />
          <Divider />
          <Row
            icon={<Lock size={18} color={COLORS.text} />}
            title="Change Password"
            sub="Update transaction signature password"
            onPress={() => setPwOpen(true)}
          />
          <Divider />
          <Row
            icon={<KeyRound size={18} color={COLORS.text} />}
            title="Export Secrets"
            sub="Backup Seed Phrases & Private Keys"
            onPress={() => setExportOpen(true)}
          />
        </Card>

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
            onPress={() => setBookOpen(true)}
          />
          <Divider />
          <Row icon={<Bell size={18} color={COLORS.text} />} title="Notifications" sub="Targets, maturity and security alerts" onPress={() => setNotifOpen(true)} />
          <Divider />
          <Row icon={<Bell size={18} color={COLORS.text} />} title="Maturity reminders" sub="Lock maturing / matured alerts in Notifications">
            <Switch value={settings.maturityReminders} onValueChange={(v) => updateSettings({ maturityReminders: v })} trackColor={{ true: COLORS.mint }} />
          </Row>
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
            onPress={doClearCache}
          />
          <Divider />
          <Row icon={<Info size={18} color={COLORS.text} />} title="About Stelix" sub="Version 2.0.0" onPress={() => setAboutOpen(true)} />
        </Card>

        {cacheMsg ? <Text style={styles.inlineOk}>{cacheMsg}</Text> : null}

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

        <OptionSheet
          visible={autoLockOpen}
          onClose={() => setAutoLockOpen(false)}
          title="Auto-Lock Timer"
          options={AUTO_LOCK_OPTIONS.map((m) => ({
            key: String(m),
            label: autoLockLabel(m),
            selected: settings.autoLockMinutes === m,
          }))}
          onSelect={(key) => updateSettings({ autoLockMinutes: Number(key) })}
        />

        <BottomSheet visible={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
          <View style={styles.sheetBody}>
            <TextInput style={styles.formInput} placeholder="Current password" secureTextEntry value={oldPw} onChangeText={setOldPw} autoCapitalize="none" />
            <TextInput style={styles.formInput} placeholder="New password (min 8 characters)" secureTextEntry value={newPw} onChangeText={setNewPw} autoCapitalize="none" />
            <TextInput style={styles.formInput} placeholder="Confirm new password" secureTextEntry value={newPw2} onChangeText={setNewPw2} autoCapitalize="none" />
            {pwMsg ? <Text style={pwOk ? styles.formOk : styles.formErr}>{pwMsg}</Text> : null}
            <Btn label={pwBusy ? 'Changing…' : 'Change Password'} onPress={() => void submitPasswordChange()} disabled={pwBusy || !oldPw || !newPw || !newPw2} />
          </View>
        </BottomSheet>

        <BottomSheet visible={exportOpen} onClose={() => { setExportOpen(false); setExported(''); }} title="Export secrets">
          <View style={styles.sheetBody}>
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
          </View>
        </BottomSheet>

        <BottomSheet visible={bookOpen} onClose={() => setBookOpen(false)} title="Address book">
          <View style={styles.sheetBody}>
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
          </View>
        </BottomSheet>

        <BottomSheet visible={notifOpen} onClose={() => setNotifOpen(false)} title="Notifications">
          <View style={styles.sheetBody}>
            {notifRows.length > 0 && notifUnread > 0 ? (
              <Btn label={`Mark all read (${notifUnread})`} variant="ghost" onPress={markAllNotifRead} />
            ) : null}
            {notifRows.length === 0 ? (
              <Text style={styles.formHint}>No notifications yet. Target progress, maturity reminders, auto-sell results and security alerts will appear here.</Text>
            ) : (
              notifRows.map((n) => (
                <View key={n.id} style={[styles.notifRow, !n.read && styles.notifUnread]}>
                  <View style={styles.notifIcon}>
                    <Bell size={16} color={n.read ? COLORS.textMuted : COLORS.mintDark} />
                  </View>
                  <View style={styles.notifMid}>
                    <Text style={styles.notifTitle}>{n.title}</Text>
                    <Text style={styles.notifBody}>{n.body}</Text>
                    <Text style={styles.notifDate}>{fmtDateTime(n.at)}</Text>
                  </View>
                  {!n.read && <View style={styles.notifDot} />}
                </View>
              ))
            )}
            <Text style={styles.formHint}>
              Alerts are derived from your locks and appear here when you open the app: target at 50% / 80% / 100%,
              target hit and auto-sell result, trailing-stop activation, maturity at 7 days / 1 day / 1 hour, break
              cooling-off, and security events. Stelix does not send push notifications yet — nothing arrives while
              the app is closed.
            </Text>
          </View>
        </BottomSheet>

        <BottomSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} title="About Stelix">
          <View style={styles.sheetBody}>
            <Text style={styles.formHint}>
              Stelix 2.0.0 · Non-custodial multichain vault wallet. Arc default · BNB · Base · Ethereum · Polygon ·
              Solana. Your keys never leave this device; locks are enforced on-chain by the StelixVault contract.
            </Text>
          </View>
        </BottomSheet>
      </ScrollView>
    </KeyboardAvoidingView>
    {!inTabs ? <BottomNav /> : null}
    </View>
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
  formErr: { color: COLORS.red, fontSize: 12, lineHeight: 17 },
  formHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  formInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 14, padding: 12 },
  formOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  group: { paddingVertical: 4 },
  inner: { padding: 12 },
  inlineOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 10, textAlign: 'center' },
  notifBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  notifDate: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  notifDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  notifIcon: { alignItems: 'center', backgroundColor: COLORS.bgMuted, borderRadius: 999, height: 36, justifyContent: 'center', width: 36 },
  notifMid: { flex: 1 },
  notifRow: { alignItems: 'flex-start', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 12 },
  notifTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  notifUnread: { backgroundColor: COLORS.mintSoft, borderRadius: 12, marginHorizontal: -8, paddingHorizontal: 8 },
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
  sheetBody: { gap: 10 },
  shell: { backgroundColor: COLORS.bg, flex: 1 },
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
