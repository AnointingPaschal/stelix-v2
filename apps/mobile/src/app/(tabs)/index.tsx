/** Screen 6 — Home / Portfolio: Spendable vs Locked, assets, quick actions. */
import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Bell, History, Lock, Settings, TrendingUp } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../../theme';
import { useApp, CHAINS } from '../../store/AppContext';
import { fmtPct, fmtUsd, shortAddress } from '../../lib/format';
import { Card, Chip, DemoBadge, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { TokenRow } from '../../components/TokenRow';

export default function Home() {
  const { address, chain, tokens, locks, notifications, setChain } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [showSpam, setShowSpam] = useState(false);

  const visible = tokens.filter((t) => !t.isSpam || showSpam);
  const spendable = tokens.reduce((s, t) => s + t.balance * t.price, 0);
  const locked = tokens.reduce((s, t) => s + t.locked * t.price, 0);
  const total = spendable + locked;
  const lockedRatio = total > 0 ? locked / total : 0;
  const unread = notifications.filter((n) => !n.read).length;

  const nearest = locks
    .filter((l) => l.status === 'active' || l.status === 'partially-sold')
    .sort((a, b) => a.unlockTime - b.unlockTime)[0];

  function onRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200); // live prices re-fetch via hook
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => Clipboard.setStringAsync(address)}>
          <View style={styles.addrRow}>
            <Image source={require('../../../assets/icon.png')} style={styles.logo} />
            <View>
              <Text style={styles.addr}>{shortAddress(address)}</Text>
              <Text style={styles.chainTap}>Tap to copy address</Text>
            </View>
          </View>
        </Pressable>
        <View style={styles.headerBtns}>
          <Pressable style={styles.iconBtn} onPress={() => router.push('/notifications')}>
            <Bell size={20} color={COLORS.navy} />
            {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => router.push('/settings')}>
            <Settings size={20} color={COLORS.navy} />
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => router.push('/(tabs)/vault')}>
        <Card dark>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Total Balance</Text>
            <DemoBadge />
          </View>
          <Text style={styles.balance}>{fmtUsd(total)}</Text>
          <Text style={styles.change24}>{fmtPct(2.1)} today</Text>
          <View style={styles.split}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Spendable</Text>
              <Text style={styles.splitValue}>{fmtUsd(spendable)}</Text>
            </View>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Locked</Text>
              <Text style={[styles.splitValue, { color: COLORS.mint }]}>{fmtUsd(locked)}</Text>
            </View>
          </View>
          <ProgressBar value={lockedRatio} />
          <Text style={styles.lockedPct}>{Math.round(lockedRatio * 100)}% of your portfolio is locked</Text>
        </Card>
      </Pressable>

      {nearest && (
        <Pressable style={styles.banner} onPress={() => router.push(`/vault/${nearest.id}`)}>
          <Lock size={16} color={COLORS.mintDark} />
          <Text style={styles.bannerText}>
            {nearest.tokenSymbol} lock matures{' '}
            {new Date(nearest.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {nearest.targetMultiple ? ` or at ${nearest.targetMultiple}x` : ''}
          </Text>
        </Pressable>
      )}

      <View style={styles.chainRow}>
        <Text style={styles.chainLabel}>Chain</Text>
        <View style={styles.chainPills}>
          {['arc', 'bnb', 'base', 'ethereum', 'polygon', 'solana'].map((id) => (
            <Pressable
              key={id}
              onPress={() => {
                const c = CHAINS.find((x) => x.id === id);
                if (c) setChain(c);
              }}
              style={[styles.pill, chain.id === id && styles.pillOn]}
            >
              <Text style={[styles.pillText, chain.id === id && styles.pillTextOn]}>{id.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {chain.testnet && <Chip label="Testnet" tone="amber" />}
      </View>

      <View style={styles.actions}>
        <Action icon={<ArrowUpRight size={22} color="#fff" />} label="Send" onPress={() => router.push('/send')} />
        <Action icon={<ArrowDownLeft size={22} color="#fff" />} label="Receive" onPress={() => router.push('/receive')} />
        <Action icon={<TrendingUp size={22} color="#fff" />} label="Swap" onPress={() => router.push('/(tabs)/swap')} />
        <Action icon={<History size={22} color="#fff" />} label="History" onPress={() => router.push('/(tabs)/history')} />
        <Action icon={<Lock size={22} color="#fff" />} label="Discipline" onPress={() => router.push('/discipline')} />
      </View>

      <SectionTitle title="My Assets" right={<DemoBadge />} />
      {visible.map((t) => (
        <TokenRow key={t.symbol} token={t} onPress={() => router.push(`/token/${t.symbol}`)} />
      ))}
      {tokens.some((t) => t.isSpam) && (
        <Pressable onPress={() => setShowSpam((s) => !s)}>
          <Text style={styles.spamToggle}>
            {showSpam ? 'Hide spam folder' : `Spam folder (${tokens.filter((t) => t.isSpam).length} hidden token${tokens.filter((t) => t.isSpam).length > 1 ? 's' : ''})`}
          </Text>
        </Pressable>
      )}
      <RiskNote />
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', gap: 6, width: '18%' },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  actionLabel: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  addr: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  addrRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  badge: {
    alignItems: 'center',
    backgroundColor: COLORS.red,
    borderRadius: 999,
    height: 16,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -4,
    width: 16,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  balance: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 },
  balanceLabel: { color: COLORS.textOnNavyMuted, fontSize: 13, fontWeight: '700' },
  balanceRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  banner: {
    alignItems: 'center',
    backgroundColor: COLORS.mintSoft,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 12,
  },
  bannerText: { color: COLORS.mintDark, flex: 1, fontSize: 13, fontWeight: '700' },
  chainLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  chainPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chainRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  chainTap: { color: COLORS.textMuted, fontSize: 11 },
  change24: { color: COLORS.mint, fontSize: 14, fontWeight: '700', marginBottom: 14 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inner: { padding: 20 },
  lockedPct: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 8 },
  logo: { borderRadius: 999, height: 40, width: 40 },
  pill: { backgroundColor: COLORS.bgMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillOn: { backgroundColor: COLORS.navy },
  pillText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  pillTextOn: { color: '#fff' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spamToggle: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  split: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  splitCol: { flex: 1 },
  splitLabel: { color: COLORS.textOnNavyMuted, fontSize: 12 },
  splitValue: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 2 },
});
