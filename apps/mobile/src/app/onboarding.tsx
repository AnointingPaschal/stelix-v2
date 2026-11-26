/** Screen 2 — Welcome / Onboarding: Lock it, Set your price, Sell automatically. */
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Lock, Target, TrendingUp } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn, RiskNote } from '../components/ui';

const SLIDES = [
  {
    icon: <Lock size={44} color={COLORS.mint} />,
    title: 'Lock it',
    body: 'Move funds into the Stelix Vault so they cannot be spent on impulse. Locked funds disappear from your spendable balance.',
  },
  {
    icon: <Target size={44} color={COLORS.mint} />,
    title: 'Set your price',
    body: 'Choose a date, a price target, or both. Unlock is whichever comes first — with a profit ladder and trailing stop if you want them.',
  },
  {
    icon: <TrendingUp size={44} color={COLORS.mint} />,
    title: 'Sell automatically',
    body: 'When your target is confirmed by a 30-minute average price, Stelix sells to stablecoin for you — even while you sleep.',
  },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  return (
    <View style={styles.root}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brand}>Stelix</Text>
      <View style={styles.card}>
        {slide.icon}
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>
      <View style={styles.dots}>
        {SLIDES.map((_, d) => (
          <View key={d} style={[styles.dot, d === i && styles.dotOn]} />
        ))}
      </View>
      <Btn
        label={i < SLIDES.length - 1 ? 'Next' : 'Create Wallet'}
        onPress={() => (i < SLIDES.length - 1 ? setI(i + 1) : router.push('/create'))}
      />
      <Btn label="I already have a wallet" variant="ghost" onPress={() => router.push('/import')} />
      <RiskNote />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: COLORS.textMuted, fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  brand: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginTop: 12 },
  card: { alignItems: 'center', marginVertical: 36, paddingHorizontal: 24 },
  dot: { backgroundColor: COLORS.border, borderRadius: 999, height: 8, width: 8 },
  dotOn: { backgroundColor: COLORS.mint, width: 24 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 24 },
  logo: { borderRadius: 999, height: 84, width: 84 },
  root: { backgroundColor: COLORS.bg, flex: 1, justifyContent: 'center', padding: 24 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '800', marginTop: 16 },
});
