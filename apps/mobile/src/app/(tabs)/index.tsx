/** Screen 6 — Home / Portfolio (v1): shared AppHeader (wallet + chain
 *  pills), navy portfolio card with Today's P&L, 5 actions in a white
 *  card, My Assets list with Import, bottom tabs
 *  Home/Swap/Discover/History/Settings. Plus v2-only, in v1 style:
 *  Spendable vs Locked split inside the card. All figures come from
 *  the store — a new wallet shows $0.00 / 0 tokens.
 *
 *  Import Token lives on its own full-screen route (/import-token):
 *  the "+ Import" button navigates there; nothing import-related
 *  lives on this screen anymore. */
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  History,
  Lock,
  TrendingUp,
} from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, fmtPct, fmtPrice, fmtUsd, shortAddress } from '../../lib/format';
import { loadWatchlist, resolveWatchlistEntries, type WatchlistEntry } from '../../lib/watchlist';
import { calcPortfolioPnl, visibleTokens } from '../../lib/balances';
import { tokenDetailRoute } from '../../lib/tokenResolve';
import { visibleAnnouncements } from '../../lib/adminSync';
import {
  Btn,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  SectionTitle,
} from '../../components/ui';
import { TokenRow } from '../../components/TokenRow';
import { TokenLogo } from '../../components/TokenLogo';
import { AppHeader } from '../../components/AppShell';

export default function Home() {
  const { chain, tokens, locks, refreshAll, announcements, maintenance, signingBlocked, dismissAnnouncement, networkMode } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 320–430px phones keep the compact v1 layout; 768px+ centres the
  // column at 768px so the page never stretches edge-to-edge on web.
  const isWide = width >= 768;
  const [refreshing, setRefreshing] = useState(false);
  const [showSpam, setShowSpam] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Watchlist (starred on Token Detail): resolved on every focus, so a
  // star added on the detail page shows here when the user comes back.
  // The old star wrote to storage and no screen ever listed it.
  const [watchEntries, setWatchEntries] = useState<WatchlistEntry[]>([]);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const keys = await loadWatchlist();
        if (cancelled) return;
        const entries = await resolveWatchlistEntries(keys, tokens);
        if (!cancelled) setWatchEntries(entries);
      })();
      return () => {
        cancelled = true;
      };
    }, [tokens]),
  );
  const visible = visibleTokens(tokens, showSpam);
  // Latest admin announcement for this chain (audience 'all' or this
  // chain's slug), unless dismissed. Maintenance scope 'wallet' shows a
  // banner here too (scope 'all' replaces the whole screen instead).
  const banner = visibleAnnouncements(announcements, chain.id)[0] ?? null;
  const priceOf = (t: { price: number | null }) => t.price ?? 0;
  const spendable = tokens.reduce((s, t) => s + t.balance * priceOf(t), 0);
  const locked = tokens.reduce((s, t) => s + t.locked * priceOf(t), 0);
  const total = spendable + locked;
  const lockedRatio = total > 0 ? locked / total : 0;
  // Today's P&L over holdings with a live price + 24h change (spendable
  // balances only — locked funds are priced separately by the lock
  // detail). Null when no holding has price data: the card shows "—".
  const pnl = calcPortfolioPnl(
    tokens.map((t) => ({
      valueUsd: t.priceUsd !== null ? t.balance * t.priceUsd : null,
      change24h: t.change24h ?? null,
    })),
  );
  const activeLocks = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold').length;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }

  const bal = (v: number) => (hidden ? '••••••' : fmtUsd(v));

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.inner,
        {
          paddingTop: 12 + insets.top,
          paddingBottom: 24 + insets.bottom,
          ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null),
        },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <AppHeader />

      {signingBlocked && maintenance.scope === 'wallet' ? (
        <View style={styles.maintBanner}>
          <Text style={styles.maintBannerTitle}>Maintenance is on</Text>
          <Text style={styles.maintBannerText}>
            {maintenance.message !== '' ? maintenance.message : 'Sending, swapping and locking are paused while maintenance is in progress.'}
          </Text>
        </View>
      ) : null}

      {banner ? (
        <View style={styles.announceBanner}>
          <View style={styles.announceHead}>
            <Text style={styles.announceTitle} numberOfLines={1}>{banner.title}</Text>
            <Pressable onPress={() => dismissAnnouncement(banner.id)} hitSlop={8}>
              <Text style={styles.announceDismiss}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.announceText}>{banner.message}</Text>
        </View>
      ) : null}

      <Pressable onPress={() => router.push('/(tabs)/vault')}>
        <Card dark style={styles.portfolio}>
          <View style={styles.portHead}>
            <Text style={styles.portLabel}>Portfolio Balance</Text>
            <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
              {hidden ? <EyeOff size={16} color={COLORS.textOnNavyMuted} /> : <Eye size={16} color={COLORS.textOnNavyMuted} />}
            </Pressable>
          </View>
          <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(total)}</Text>
          <View style={styles.pillsRow}>
            <Chip label={chain.nativeSymbol} tone="navy" />
            {chain.testnet ? <Chip label="Testnet" tone="amber" /> : null}
            {networkMode !== null ? <Chip label={networkMode === 'testnet' ? 'Testnet mode' : 'Mainnet mode'} tone="navy" /> : null}
          </View>
          <View style={styles.divider} />
          <View style={styles.pnlRow}>
            <Text style={styles.pnlLabel}>Today's P&amp;L</Text>
            <Text
              style={[
                styles.pnlValue,
                {
                  color:
                    pnl.pnl === null
                      ? COLORS.textOnNavyMuted
                      : pnl.pnl >= 0
                        ? COLORS.mintDark
                        : COLORS.red,
                },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {hidden
                ? '••••••'
                : pnl.pnl === null
                  ? '—'
                  : `${pnl.pnl >= 0 ? '+' : '-'}${fmtUsd(Math.abs(pnl.pnl))} (${fmtPct(pnl.pct ?? 0)})`}
            </Text>
          </View>
          <View style={styles.split}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Spendable</Text>
              <Text style={styles.splitValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(spendable)}</Text>
            </View>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Locked</Text>
              <Text style={[styles.splitValue, { color: COLORS.mint }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(locked)}</Text>
            </View>
            <Text style={styles.splitPct}>{Math.round(lockedRatio * 100)}% locked</Text>
          </View>
          <ProgressBar value={lockedRatio} />
          {activeLocks > 0 ? (
            <Text style={styles.lockNote}>{activeLocks} active lock{activeLocks > 1 ? 's' : ''} — tap to open the Vault</Text>
          ) : null}
        </Card>
      </Pressable>

      <Card style={styles.actionsCard}>
        <View style={styles.actions}>
          <Action icon={<ArrowUpRight size={20} color="#fff" />} label="Send" onPress={() => router.push('/send')} />
          <View style={styles.actionDiv} />
          <Action icon={<ArrowDownLeft size={20} color="#fff" />} label="Receive" onPress={() => router.push('/receive')} />
          <View style={styles.actionDiv} />
          <Action icon={<TrendingUp size={20} color="#fff" />} label="Swap" onPress={() => router.push('/(tabs)/swap')} />
          <View style={styles.actionDiv} />
          <Action icon={<History size={20} color="#fff" />} label="History" onPress={() => router.push('/(tabs)/history')} />
          <View style={styles.actionDiv} />
          <Action icon={<Lock size={20} color="#fff" />} label="Discipline" onPress={() => router.push('/discipline')} />
        </View>
      </Card>

      <SectionTitle
        title="My Assets"
        right={
          <Btn label="+ Import" onPress={() => router.push('/import-token')} style={styles.importBtn} />
        }
      />
      {visible.length === 0 ? (
        <EmptyState
          title="No tokens yet"
          body="Receive funds or import a token to see your assets here."
          actionLabel="Receive"
          onAction={() => router.push('/receive')}
        />
      ) : (
        visible.map((t) => (
          <TokenRow
            key={`${t.chainId}:${t.address || t.symbol}`}
            token={t}
            onPress={() => router.push(tokenDetailRoute(t))}
          />
        ))
      )}
      {tokens.some((t) => t.isSpam) && (
        <Pressable onPress={() => setShowSpam((s) => !s)}>
          <Text style={styles.spamToggle}>
            {showSpam
              ? 'Hide spam folder'
              : `Spam folder (${tokens.filter((t) => t.isSpam).length} hidden token${tokens.filter((t) => t.isSpam).length > 1 ? 's' : ''})`}
          </Text>
        </Pressable>
      )}

      {watchEntries.length > 0 ? (
        <>
          <SectionTitle title="Watchlist" />
          {watchEntries.map((w) => (
            <Pressable
              key={w.key}
              style={styles.watchRow}
              onPress={() =>
                router.push(tokenDetailRoute({ symbol: w.symbol, address: w.address, chainId: w.chainId }))
              }
            >
              <TokenLogo chainId={w.chainId} address={w.address} symbol={w.symbol} size={38} fallbackTone="light" />
              <View style={styles.watchMid}>
                <Text style={styles.watchName} numberOfLines={1}>
                  {w.symbol || shortAddress(w.address, 4)}
                </Text>
                <Text style={styles.watchSub} numberOfLines={1}>
                  {w.held ? `Held · ${fmtNum(w.balance, 4)}` : w.name || w.chainId}
                </Text>
              </View>
              <View style={styles.watchRight}>
                <Text style={styles.watchPrice} numberOfLines={1}>
                  {w.priceUsd === null ? '—' : fmtPrice(w.priceUsd)}
                </Text>
                <Text
                  style={[
                    styles.watchChange,
                    { color: w.change24h === null ? COLORS.textMuted : w.change24h >= 0 ? COLORS.mintDark : COLORS.red },
                  ]}
                  numberOfLines={1}
                >
                  {w.change24h === null ? '' : fmtPct(w.change24h)}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flex: 1, gap: 6, minWidth: 0 },
  actionDiv: { backgroundColor: COLORS.border, height: 40, width: 1 },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actionLabel: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  actions: { alignItems: 'center', flexDirection: 'row' },
  actionsCard: { marginTop: 12, paddingVertical: 14 },
  balance: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 2 },
  divider: { backgroundColor: COLORS.navySoft, height: 1, marginVertical: 10 },
  importBtn: { minHeight: 32, paddingHorizontal: 12 },
  maintBanner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  maintBannerTitle: { color: '#92400E', fontSize: 14, fontWeight: '800' },
  maintBannerText: { color: '#92400E', fontSize: 13, lineHeight: 18, marginTop: 4 },
  announceBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  announceHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  announceTitle: { color: COLORS.navy, flex: 1, fontSize: 14, fontWeight: '800' },
  announceDismiss: { color: COLORS.textMuted, fontSize: 14, fontWeight: '700', paddingHorizontal: 4 },
  announceText: { color: COLORS.text, fontSize: 13, lineHeight: 18, marginTop: 4 },
  inner: { padding: 12 },
  lockNote: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 8 },
  pillsRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  pnlLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  pnlRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  pnlValue: { fontSize: 14, fontWeight: '800' },
  portHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  portLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  portfolio: { padding: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spamToggle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  split: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 8, marginTop: 10 },
  splitCol: { flex: 1, minWidth: 0 },
  splitLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  splitPct: { color: COLORS.textOnNavyMuted, fontSize: 11, fontWeight: '700' },
  splitValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 2 },
  watchChange: { fontSize: 12, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  watchMid: { flex: 1, minWidth: 0 },
  watchName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  watchPrice: { color: COLORS.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  watchRight: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  watchRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  watchSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
});
