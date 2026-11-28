/** AppShell — shared chrome for every wallet screen: the AppHeader
 *  (wallet pill left, chain pill right, exactly like Home's topRow)
 *  and the BottomNav (the same 5 tabs as the native tab bar, for the
 *  stack screens that sit outside the tab navigator).
 *
 *  Tab-group screens render AppHeader only (the native tab bar already
 *  shows there). Stack screens render AppHeader with showBack plus
 *  BottomNav at the bottom. The header scrolls with the screen's
 *  content, exactly like Home's topRow does today — the screen's own
 *  `paddingTop: 12 + insets.top` still clears the status bar. */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  History,
  Home,
  Settings as SettingsIcon,
  User,
  X,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { shortAddress } from '../lib/format';
import { BottomSheet, NetworkSheet } from './ui';

/** Wallet pill + chain pill. With showBack, a back chevron sits at the
 *  left (stack screens) — the screen's own back button is removed so
 *  there is only one. The chain pill opens the existing NetworkSheet;
 *  the wallet pill opens the Wallets sheet (same rows as Home). */
export function AppHeader({ showBack }: { showBack?: boolean }) {
  const { address, wallets, activeWalletId, switchWallet, removeWallet, chain } = useApp();
  const { width } = useWindowDimensions();
  const isNarrow = width < 360;
  const [netOpen, setNetOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  /** Two-tap remove in the Wallets sheet: first tap arms the confirm,
   *  second tap removes. Inline (never Alert.alert — a no-op on web). */
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  return (
    <>
      <View style={styles.topRow}>
        {showBack ? (
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" style={styles.backBtn}>
            <ChevronLeft size={22} color={COLORS.text} />
          </Pressable>
        ) : null}
        <Pressable style={styles.addrPill} onPress={() => setWalletsOpen(true)}>
          <View style={styles.addrAvatar}>
            <User size={14} color="#fff" />
          </View>
          <Text style={styles.addrText} numberOfLines={1}>
            {address ? shortAddress(address, isNarrow ? 4 : 6) : 'No wallet yet'}
          </Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
        <Pressable style={styles.netPill} onPress={() => setNetOpen(true)}>
          <View style={styles.netDot} />
          <Text style={styles.netText} numberOfLines={1}>{chain.name}</Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
      </View>

      <NetworkSheet visible={netOpen} onClose={() => setNetOpen(false)} />

      <BottomSheet visible={walletsOpen} onClose={() => { setWalletsOpen(false); setConfirmRemoveId(null); }} title="Wallets">
        {wallets.map((w, i) => {
          const isActive = w.id === activeWalletId;
          const confirming = confirmRemoveId === w.id;
          return (
            <View key={w.id} style={styles.walletRow}>
              <Pressable
                style={styles.walletRowMain}
                onPress={async () => {
                  if (isActive) {
                    await Clipboard.setStringAsync(w.address);
                  } else {
                    await switchWallet(w.id);
                  }
                  setWalletsOpen(false);
                }}
              >
                <View style={styles.walletIcon}>
                  <User size={16} color="#fff" />
                </View>
                <View style={styles.walletMid}>
                  <Text style={styles.walletName}>{w.name ?? `Wallet ${i + 1}`}</Text>
                  <Text style={styles.walletAddr}>{shortAddress(w.address)}</Text>
                </View>
                {isActive ? <Check size={16} color={COLORS.mintDark} /> : null}
              </Pressable>
              {wallets.length > 1 ? (
                <Pressable
                  hitSlop={8}
                  style={styles.walletRemoveBtn}
                  onPress={async () => {
                    if (!confirming) {
                      setConfirmRemoveId(w.id);
                      return;
                    }
                    setConfirmRemoveId(null);
                    await removeWallet(w.id);
                  }}
                >
                  {confirming ? (
                    <Text style={styles.walletRemoveConfirm}>Remove?</Text>
                  ) : (
                    <X size={16} color={COLORS.textMuted} />
                  )}
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Pressable
          style={styles.walletRow}
          onPress={() => {
            setWalletsOpen(false);
            router.push('/wallet-setup');
          }}
        >
          <View style={styles.walletAdd}>
            <Text style={styles.walletAddText}>+</Text>
          </View>
          <Text style={styles.walletName}>Import / Create wallet</Text>
          <ChevronRight size={16} color={COLORS.textMuted} />
        </Pressable>
        <Text style={styles.sheetHint}>Tap a wallet to switch to it. Tap the active wallet to copy its address.</Text>
        <Text style={styles.sheetHint}>All your wallets stay saved on this device. Removing a wallet deletes it from this device — back up its seed phrase first.</Text>
      </BottomSheet>
    </>
  );
}

const TABS = [
  { label: 'Home', route: '/(tabs)', icon: Home },
  { label: 'Swap', route: '/(tabs)/swap', icon: ArrowLeftRight },
  { label: 'Discover', route: '/(tabs)/discover', icon: Compass },
  { label: 'History', route: '/(tabs)/history', icon: History },
  { label: 'Settings', route: '/(tabs)/settings', icon: SettingsIcon },
] as const;

/** Bottom nav for stack screens — the same 5 tabs, icons, labels,
 *  colours and height (60 + safe-area insets) as the native tab bar
 *  in (tabs)/_layout.tsx. Highlights the current route. */
export function BottomNav() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  // usePathname keeps the group segment ("/(tabs)/swap"); strip it so
  // the match works whatever form the router reports.
  const norm = pathname.replace(/\/\([^)]+\)/g, '') || '/';

  return (
    <View style={[styles.nav, { height: 60 + insets.bottom, paddingBottom: 6 + insets.bottom }]}>
      {TABS.map(({ label, route, icon: Icon }) => {
        const active = norm === route.replace('/(tabs)', '') || (label === 'Home' && norm === '/');
        const color = active ? COLORS.navy : COLORS.textMuted;
        return (
          <Pressable
            key={label}
            style={styles.navTab}
            onPress={() => {
              if (!active) router.push(route);
            }}
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <Icon size={24} color={color} />
            <Text style={[styles.navLabel, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  addrAvatar: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  addrPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addrText: { color: COLORS.text, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  backBtn: { alignItems: 'center', justifyContent: 'center' },
  nav: {
    backgroundColor: '#fff',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  navLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  navTab: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  netPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  netText: { color: COLORS.text, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  sheetHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 12 },
  walletAdd: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  walletAddText: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  walletAddr: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  walletIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  walletMid: { flex: 1 },
  walletName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  walletRemoveBtn: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  walletRemoveConfirm: { color: COLORS.red, fontSize: 13, fontWeight: '700' },
  walletRow: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    padding: 10,
  },
  walletRowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10 },
});
