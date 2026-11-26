import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '../store/AppContext';
import { COLORS } from '../theme';

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
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
    </AppProvider>
  );
}
