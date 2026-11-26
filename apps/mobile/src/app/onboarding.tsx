/** Screen 2 — Welcome (v1 compact): small logo, "Welcome to Stelix" 18px,
 *  short intro, three compact points, Create New Wallet / Import Existing
 *  Wallet buttons. No oversized headings. */
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, Target, TrendingUp } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn, RiskNote, centeredContent } from '../components/ui';

const POINTS = [
  { icon: <Lock size={18} color={COLORS.mintDark} />, title: 'Lock it', body: 'Move funds into the Vault so they cannot be spent on impulse.' },
  { icon: <Target size={18} color={COLORS.mintDark} />, title: 'Set your price', body: 'Choose a date, a price target, or both. Unlock is whichever comes first.' },
  { icon: <TrendingUp size={18} color={COLORS.mintDark} />, title: 'Sell automatically', body: 'When your target is confirmed, Stelix sells to stablecoin for you.' },
];

export default function Onboarding() {
  const insets = useSafeAreaInsets();
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
        The minimalist, non-custodial Web3 gateway. Create a new secure vault or import your existing keys to get started.
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
      <Btn label="Create New Wallet" onPress={() => router.push('/create')} />
      <View style={styles.gap} />
      <Btn label="Import Existing Wallet" variant="ghost" onPress={() => router.push('/import')} />
      <RiskNote />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  brand: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 24 },
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
