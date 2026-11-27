/** Screen 2 — Welcome (v1 compact): small logo, "Welcome to Stelix" 18px,
 *  short intro, three compact points, wallet choice:
 *  - Arc — Circle wallet (no seed phrase): EAS build only, not Expo Go.
 *  - Self-custody wallet (seed phrase): create new / import existing.
 *  No oversized headings. */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyRound, Lock, ShieldCheck, Target, TrendingUp } from 'lucide-react-native';
import { COLORS } from '../theme';
import { useCircleWallet } from '../store/CircleWalletContext';
import { Btn, Card, Chip, RiskNote, centeredContent } from '../components/ui';

const POINTS = [
  { icon: <Lock size={18} color={COLORS.mintDark} />, title: 'Lock it', body: 'Move funds into the Vault so they cannot be spent on impulse.' },
  { icon: <Target size={18} color={COLORS.mintDark} />, title: 'Set your price', body: 'Choose a date, a price target, or both. Unlock is whichever comes first.' },
  { icon: <TrendingUp size={18} color={COLORS.mintDark} />, title: 'Sell automatically', body: 'When your target is confirmed, Stelix sells to stablecoin for you.' },
];

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const circle = useCircleWallet();
  const circleNote = circle.ready
    ? 'Circle is ready on this build.'
    : circle.status === 'checking'
      ? 'Checking Circle support…'
      : 'Circle wallet needs the EAS build — not available in Expo Go.';
  return (
    <View style={[styles.root, centeredContent, { paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom }]}>
      <View style={styles.brandRow}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <View>
          <Text style={styles.brand}>Stelix</Text>
          <Text style={styles.tag}>Your Financial Discipline</Text>
        </View>
      </View>
      <Text style={styles.title}>Welcome to Stelix.</Text>
      <Text style={styles.body}>
        The minimalist, non-custodial Web3 gateway. Choose how your wallet works — then create or import it to get started.
      </Text>
      {POINTS.map((p) => (
        <View key={p.title} style={styles.point}>
          <View style={styles.pointIcon}>{p.icon}</View>
          <View style={styles.pointMid}>
            <Text style={styles.pointTitle}>{p.title}</Text>
            <Text style={styles.pointBody}>{p.body}</Text>
          </View>
        </View>
      ))}
      <View style={styles.spacer} />
      <Text style={styles.choiceLabel}>CHOOSE YOUR WALLET</Text>
      <Card style={styles.choice}>
        <Pressable style={styles.choiceRow} onPress={() => router.push('/circle')}>
          <View style={styles.pointIcon}>
            <ShieldCheck size={18} color={COLORS.mintDark} />
          </View>
          <View style={styles.pointMid}>
            <Text style={styles.pointTitle}>Arc — Circle wallet (no seed phrase)</Text>
            <Text style={styles.pointBody}>
              MPC wallet on Arc. Approve transactions with a Circle PIN — nothing to back up or lose.
            </Text>
            <Text style={styles.choiceNote}>{circleNote}</Text>
          </View>
          <Chip label={circle.ready ? 'Ready' : 'EAS only'} tone={circle.ready ? 'mint' : 'amber'} />
        </Pressable>
      </Card>
      <View style={styles.gap} />
      <Card style={styles.choice}>
        <View style={styles.choiceRow}>
          <View style={styles.pointIcon}>
            <KeyRound size={18} color={COLORS.mintDark} />
          </View>
          <View style={styles.pointMid}>
            <Text style={styles.pointTitle}>Self-custody wallet (seed phrase)</Text>
            <Text style={styles.pointBody}>
              Your keys, your 12-word seed phrase. Works on Arc, BNB, Base, Ethereum, Polygon and Solana.
            </Text>
          </View>
        </View>
        <View style={styles.gap} />
        <Btn label="Create New Wallet" onPress={() => router.push('/create')} />
        <View style={styles.gap} />
        <Btn label="Import Existing Wallet" variant="ghost" onPress={() => router.push('/import')} />
      </Card>
      <RiskNote />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  brand: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 24 },
  choice: { padding: 12 },
  choiceLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  choiceNote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  choiceRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  gap: { height: 10 },
  logo: { borderRadius: 999, height: 56, width: 56 },
  point: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, marginTop: 14 },
  pointBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  pointIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.mintSoft,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pointMid: { flex: 1 },
  pointTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  root: { backgroundColor: COLORS.bg, flex: 1, justifyContent: 'center', padding: 16 },
  spacer: { flex: 1 },
  tag: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
