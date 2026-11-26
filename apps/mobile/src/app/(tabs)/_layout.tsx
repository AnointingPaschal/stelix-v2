import { Tabs } from 'expo-router';
import { ArrowLeftRight, Compass, History, Home, Settings as SettingsIcon } from 'lucide-react-native';
import { COLORS } from '../../theme';

/** v1 bottom tabs: Home / Swap / Discover / History / Settings.
 *  Vault Hub stays a route (reachable from Discipline / lock links) but is
 *  not a tab, as in v1. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.navy,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: COLORS.border, height: 60, paddingBottom: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="swap"
        options={{
          title: 'Swap',
          tabBarIcon: ({ color, size }) => <ArrowLeftRight size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => <Compass size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <History size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <SettingsIcon size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="vault" options={{ href: null }} />
    </Tabs>
  );
}
