/** Screen 1 — Splash: brand, tagline, signed-config load (1.5s fade). */
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';

export default function Splash() {
  const fade = useRef(new Animated.Value(0)).current;
  const { onboarded, unlocked } = useApp();

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 900, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      if (!onboarded) router.replace('/onboarding');
      else if (!unlocked) router.replace('/unlock');
      else router.replace('/(tabs)');
    }, 1600);
    return () => clearTimeout(t);
  }, [fade, onboarded, unlocked]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.inner, { opacity: fade }]}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.name}>Stelix</Text>
        <Text style={styles.tag}>Your Financial Discipline</Text>
        <Text style={styles.sub}>Lock it. Hold it. Exit on your plan.</Text>
      </Animated.View>
      <Text style={styles.foot}>Non-custodial · Arc first · DEMO build</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  foot: { bottom: 40, color: COLORS.textOnNavyMuted, fontSize: 12, position: 'absolute' },
  inner: { alignItems: 'center' },
  logo: { borderRadius: 999, height: 120, width: 120 },
  name: { color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 20 },
  root: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    flex: 1,
    justifyContent: 'center',
  },
  sub: { color: COLORS.textOnNavyMuted, fontSize: 14, marginTop: 8 },
  tag: { color: COLORS.mint, fontSize: 17, fontWeight: '700', marginTop: 10 },
});
