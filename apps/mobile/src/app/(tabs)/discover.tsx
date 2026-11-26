/** Screen 11 — Discover (v1): centred title, Trending / Gainers /
 *  Top SMC Token tabs (amber underline on the active tab), token count pill,
 *  search, Token / Price / 24h / Liquidity table. Rows tap through to the
 *  token detail. Data is LIVE from DexScreener search (verified) and
 *  GeckoTerminal trending (unverified — an empty list + error is shown
 *  when it fails, never a fabricated list). Empty state when the feed
 *  returns nothing. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Flame, Landmark, RefreshCw, Search, TrendingUp } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { fetchTrending, searchTokens, type DiscoverToken } from '../../lib/discover';
import { EmptyState } from '../../components/ui';

type Tab = 'trending' | 'gainers' | 'top';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'trending', label: 'Trending', icon: <Flame size={14} color={COLORS.amber} /> },
  { key: 'gainers', label: 'Gainers', icon: <TrendingUp size={14} color={COLORS.textMuted} /> },
  { key: 'top', label: 'Top SMC Token', icon: <Landmark size={14} color={COLORS.textMuted} /> },
];

function compactUsd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtUsd(n, 0);
}

export default function Discover() {
  const { chain } = useApp();
  const [tab, setTab] = useState<Tab>('trending');
  const [query, setQuery] = useState('');
  const [tokens, setTokens] = useState<DiscoverToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = q.trim()
          ? await searchTokens(q.trim())
          : await fetchTrending(20);
        setTokens(res.tokens);
        setSource(res.source);
        setError(res.error);
      } catch (e) {
        setTokens([]);
        setSource(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  // Live search as the user types (debounced 500ms); clearing the query
  // reloads trending.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 500);
    return () => clearTimeout(t);
  }, [query, load]);

  const list = useMemo(() => {
    const sorted = [...tokens];
    if (tab === 'gainers') return sorted.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));
    if (tab === 'top') return sorted.sort((a, b) => (b.marketCap ?? -Infinity) - (a.marketCap ?? -Infinity));
    return sorted.sort((a, b) => (b.volume24h ?? -Infinity) - (a.volume24h ?? -Infinity));
  }, [tokens, tab]);

  const tabTitle = tab === 'trending' ? 'Trending' : tab === 'gainers' ? 'Gainers' : 'Top SMC Token';
  const tabSub =
    tab === 'trending'
      ? `Most active DEX pools on ${chain.name} right now`
      : tab === 'gainers'
        ? `Biggest 24h movers on ${chain.name}`
        : `Largest tokens on ${chain.name} by market cap`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <View style={styles.headSide} />
        <Text style={styles.title}>Discover</Text>
        <Pressable
          onPress={() => void load(query)}
          style={styles.headSide}
          hitSlop={8}
        >
          <RefreshCw size={18} color={COLORS.text} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <View style={styles.tabLabel}>
              {t.icon}
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            </View>
            {tab === t.key ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlineOff} />}
          </Pressable>
        ))}
      </View>

      <View style={styles.blockHead}>
        <View style={styles.blockIcon}>
          <Flame size={16} color={COLORS.amber} />
        </View>
        <View style={styles.blockMid}>
          <Text style={styles.blockTitle}>{tabTitle}</Text>
          <Text style={styles.blockSub}>{tabSub}</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{list.length} tokens</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Search size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.search}
          placeholder="Search symbol or name…"
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {source ? <Text style={styles.source}>Source: {source}</Text> : null}

      <View style={styles.tableHead}>
        <Text style={[styles.th, styles.thToken]}>Token</Text>
        <Text style={[styles.th, styles.thRight]}>Price</Text>
        <Text style={[styles.th, styles.thRight]}>24h</Text>
        <Text style={[styles.th, styles.thRight]}>Liquidity</Text>
      </View>

      {loading ? (
        <Text style={styles.loading}>Loading tokens…</Text>
      ) : list.length === 0 ? (
        <EmptyState
          title={query ? 'No tokens match that search' : `No tokens found on ${chain.name} yet`}
          body={query ? 'Try a different symbol or name.' : 'Trending tokens will appear here once the live feed returns data.'}
        />
      ) : (
        list.map((t, i) => (
          <Pressable
            key={`${t.chainId}:${t.address}`}
            style={styles.row}
            onPress={() =>
              router.push({
                pathname: '/token/[symbol]',
                params: { symbol: t.symbol, address: t.address, chainId: t.chainId },
              })
            }
          >
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{t.symbol.slice(0, 1)}</Text>
            </View>
            <View style={styles.mid}>
              <Text style={styles.name}>{t.symbol}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {t.symbol} / {t.chainId === 'bsc' ? 'WBNB' : chain.nativeSymbol} · {t.name}
              </Text>
            </View>
            <Text style={[styles.cell, styles.cellRight]}>{t.priceUsd === null ? '—' : fmtPrice(t.priceUsd)}</Text>
            <Text
              style={[
                styles.cell,
                styles.cellRight,
                { color: t.change24h === null ? COLORS.textMuted : t.change24h >= 0 ? COLORS.mintDark : COLORS.red },
              ]}
            >
              {t.change24h === null ? '—' : fmtPct(t.change24h)}
            </Text>
            <Text style={[styles.cell, styles.cellRight, styles.liq]}>{compactUsd(t.liquidityUsd)}</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  blockHead: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 },
  blockIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.amberSoft,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  blockMid: { flex: 1 },
  blockSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  blockTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  cell: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  cellRight: { textAlign: 'right', width: 62 },
  countPill: { backgroundColor: COLORS.amberSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  countText: { color: '#B45309', fontSize: 11, fontWeight: '700' },
  error: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 10 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headSide: { alignItems: 'center', width: 32 },
  inner: { padding: 12 },
  liq: { color: COLORS.textMuted, fontWeight: '600' },
  loading: { color: COLORS.textMuted, fontSize: 12, marginTop: 20, textAlign: 'center' },
  mid: { flex: 1 },
  name: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  rank: { color: COLORS.textMuted, fontSize: 12, width: 16 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  search: { flex: 1, fontSize: 14, paddingVertical: 8 },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 10,
  },
  source: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
  sub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  tab: { flex: 1 },
  tabLabel: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center', paddingVertical: 8 },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextOn: { color: COLORS.text },
  tabUnderline: { backgroundColor: COLORS.amber, height: 3, borderRadius: 2 },
  tabUnderlineOff: { height: 3 },
  tableHead: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingBottom: 6,
    paddingLeft: 60,
  },
  tabs: { borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', marginTop: 8 },
  th: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  thRight: { textAlign: 'right', width: 62 },
  thToken: { flex: 1 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
