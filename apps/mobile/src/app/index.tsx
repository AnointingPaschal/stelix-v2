/** Screen 1 — Splash (v1): white, logo centred on a mint glow circle,
 *  STELIX letterspaced, "Your Financial Discipline", mint dots, thin mint
 *  progress line at the bottom. Logo file is used as-is. */
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';

const DOTS = [
  { left: '8%', top: '28%', size: 6 },
  { left: '82%', top: '24%', size: 5 },
  { left: '14%', top: '72%', size: 7 },
  { left: '76%', top: '68%', size: 6 },
  { left: '58%', top: '82%', size: 5 },
  { left: '30%', top: '12%', size: 4 },
  { left: '88%', top: '52%', size: 4 },
];

export default function Splash() {
  const fade = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const { onboarded, unlocked } = useApp();

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }).start();
    Animated.timing(line, { toValue: 1, duration: 1400, useNativeDriver: false }).start();
    const t = setTimeout(() => {
      if (!onboarded) router.replace('/onboarding');
      else if (!unlocked) router.replace('/unlock');
      else router.replace('/(tabs)');
    }, 1600);
    return () => clearTimeout(t);
  }, [fade, line, onboarded, unlocked]);

  return (
    <View style={styles.root}>
      {DOTS.map((d, i) => (
        <View key={i} style={[styles.dot, { left: d.left as never, top: d.top as never, height: d.size, width: d.size }]} />
      ))}
      <Animated.View style={[styles.inner, { opacity: fade }]}>
        <View style={styles.glow}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.name}>S T E L I X</Text>
        <Text style={styles.tag}>Your Financial Discipline</Text>
      </Animated.View>
      <View style={styles.lineTrack}>
        <Animated.View style={[styles.line, { width: line.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { backgroundColor: COLORS.mint, borderRadius: 999, opacity: 0.5, position: 'absolute' },
  glow: {
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 999,
    borderWidth: 1,
    height: 220,
    justifyContent: 'center',
    width: 220,
  },
  inner: { alignItems: 'center' },
  line: { backgroundColor: COLORS.mint, height: 2 },
  lineTrack: { bottom: 48, height: 2, left: 32, position: 'absolute', right: 32 },
  logo: { borderRadius: 999, height: 150, width: 150 },
  name: { color: COLORS.navy, fontSize: 24, fontWeight: '800', letterSpacing: 6, marginTop: 28 },
  root: { alignItems: 'center', backgroundColor: COLORS.bg, flex: 1, justifyContent: 'center' },
  tag: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 3, marginTop: 10 },
});
