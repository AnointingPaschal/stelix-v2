// MUST be the first import, before every other import: installs
// global.crypto.getRandomValues on Hermes (which ships no crypto global
// at all) before ethers / wallet / crypto code runs. No-op on web
// (its index.web.js is empty — web already has crypto). It does NOT
// load the Expo crypto package: the polyfill only touches a native
// module at call time, and crypto.ts falls back gracefully (Expo native
// module probe, then a labelled degraded DRBG) if the host Expo Go
// lacks one.
import 'react-native-get-random-values';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../store/AppContext';
import { CircleWalletProvider } from '../store/CircleWalletContext';
import MaintenanceScreen from '../components/MaintenanceScreen';
import { COLORS } from '../theme';

/** Shown while the stored-wallet check is still running, so a first
 *  load / reload never renders a blank white page. Same white/navy v1
 *  splash look as the Splash screen (logo, STELIX, tagline, mint line). */
function BootSplash() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.glow}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.name}>S T E L I X</Text>
      <Text style={styles.tag}>Your Financial Discipline</Text>
      <View style={[styles.lineTrack, { bottom: 48 + insets.bottom }]}>
        <View style={styles.line} />
      </View>
    </View>
  );
}

function RootNavigator() {
  const { hydrated, maintenanceBlocksApp } = useApp();
  if (!hydrated) return <BootSplash />;
  // Maintenance scope 'all': the whole wallet is behind the maintenance
  // screen until the admin switches it off (the admin portal itself is
  // never blocked, so this can always be turned off).
  if (maintenanceBlocksApp) return <MaintenanceScreen />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="create" />
      <Stack.Screen name="import" />
      <Stack.Screen name="wallet-setup" />
      <Stack.Screen name="circle" />
      <Stack.Screen name="unlock" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="token/[symbol]" />
      <Stack.Screen name="tx/[hash]" />
      <Stack.Screen name="send" />
      <Stack.Screen name="receive" />
      <Stack.Screen name="vault/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="discipline" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <CircleWalletProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </CircleWalletProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
  line: { backgroundColor: COLORS.mint, height: 2, width: '60%' },
  lineTrack: { alignItems: 'center', bottom: 48, left: 32, position: 'absolute', right: 32 },
  logo: { borderRadius: 999, height: 150, width: 150 },
  name: { color: COLORS.navy, fontSize: 24, fontWeight: '800', letterSpacing: 6, marginTop: 28 },
  root: { alignItems: 'center', backgroundColor: COLORS.bg, flex: 1, justifyContent: 'center' },
  tag: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 3, marginTop: 10 },
});
