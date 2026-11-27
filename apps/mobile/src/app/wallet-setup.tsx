/** Wallet setup — the single entry point from the Home Wallets sheet.
 *  The sheet itself has only "Wallet 1" (tap to copy) and one
 *  "Import / Create wallet" row; that row opens this page, which has
 *  exactly TWO buttons: "Create new wallet" (-> /create) and
 *  "Import existing wallet" (-> /import). There is no separate Switch
 *  Wallet / Create New Wallet row in the sheet any more (removed
 *  2026-11-27 at the user's instruction).
 *
 *  The warning is kept verbatim: new wallets are added alongside the
 *  existing ones — nothing is replaced. Removing a wallet later deletes
 *  it from this device, so back up its seed phrase first. */
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyRound, Plus } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn, Card, RiskNote, ScreenHeader, centeredContent } from '../components/ui';

export default function WalletSetup() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
      <ScreenHeader title="Import / Create wallet" onBack={() => router.back()} />
      <Text style={styles.body}>
        Choose how to set up a wallet on this device.
      </Text>
      <Card style={styles.choice}>
        <View style={styles.choiceRow}>
          <View style={styles.icon}>
            <Plus size={18} color={COLORS.mintDark} />
          </View>
          <View style={styles.choiceMid}>
            <Text style={styles.choiceTitle}>Create new wallet</Text>
            <Text style={styles.choiceBody}>Generate a fresh 12-word seed phrase and a new wallet.</Text>
          </View>
        </View>
        <View style={styles.gap} />
        <Btn label="Create new wallet" onPress={() => router.push('/create')} />
      </Card>
      <Card style={styles.choice}>
        <View style={styles.choiceRow}>
          <View style={styles.icon}>
            <KeyRound size={18} color={COLORS.mintDark} />
          </View>
          <View style={styles.choiceMid}>
            <Text style={styles.choiceTitle}>Import existing wallet</Text>
            <Text style={styles.choiceBody}>Restore a wallet from its 12-word seed phrase or private key.</Text>
          </View>
        </View>
        <View style={styles.gap} />
        <Btn label="Import existing wallet" variant="ghost" onPress={() => router.push('/import')} />
      </Card>
      <Text style={styles.warn}>
        New wallets are added alongside your existing ones — nothing is replaced. Removing a wallet later deletes it from this device, so back up its seed phrase first.
      </Text>
      <RiskNote />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  choice: { marginTop: 12, padding: 12 },
  choiceBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  choiceMid: { flex: 1 },
  choiceRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  choiceTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  gap: { height: 10 },
  icon: {
    alignItems: 'center',
    backgroundColor: COLORS.mintSoft,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  root: { backgroundColor: COLORS.bg, flex: 1, padding: 12 },
  warn: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
});
