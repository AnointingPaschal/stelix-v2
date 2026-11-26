import { Image, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../store/AppContext';
import { COLORS } from '../theme';

/** Shown while the stored-wallet check is still running, so a first
 *  load / reload never renders a blank white page. Same white/navy v1
 *  splash look as the Splash screen (logo, STELIX, tagline, mint line). */
function BootSplash() {
  return (
    <View style={styles.root}>
      <View style={styles.glow}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.name}>S T E L I X</Text>
      <Text style={styles.tag}>Your Financial Discipline</Text>
      <View style={styles.lineTrack}>
        <View style={styles.line} />
      </View>
    </View>
  );
}

function RootNavigator() {
  const { hydrated } = useApp();
  if (!hydrated) return <BootSplash />;
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
      <Stack.Screen name="unlock" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="token/[symbol]" />
      <Stack.Screen name="send" />
      <Stack.Screen name="receive" />
      <Stack.Screen name="vault/create" />
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
        <StatusBar style="dark" />
        <RootNavigator />
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
