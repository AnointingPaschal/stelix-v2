/** Screen 11 — Discover: a full DEX browser (DexScreener-style).
 *
 * Tabs: Trending / Gainers / New Pairs, plus a chain
 * filter (All, Arc, BNB, Base, Ethereum, Polygon, Solana). Data is LIVE:
 * GeckoTerminal trending pools (Trending/Gainers — same feed, ranked
 * differently) and new pools per network (New Pairs), DexScreener search
 * for symbol/name/address, DexScreener batch lookup enriching each row
 * with its real logo, full name and market cap. DexScreener boosts /
 * profiles are the fallbacks when a primary feed fails.
 *
 * Infinite scroll: page 1 loads on tab / chain / search change, then
 * the next GeckoTerminal page is fetched as the user scrolls near the
 * bottom, appending and deduping, until a page comes back empty or
 * short. Search is not paged (DexScreener search path).
 *
 * One row per token (deduplicated on the highest-liquidity pair, DEX
 * noted in the row). Every row shows the real logo (letter circle only
 * when no source has a logo), price in subscript format for tiny prices,
 * 24h change, market cap, 24h volume, liquidity and pair age — before
 * the user taps through to the full Token Detail. Advanced filters: min
 * liquidity, min 24h volume, min market cap, max age / new only, DEX,
 * chain, search. Sort: Trending, Volume, Market Cap, Newest, Gainers.
 * No auto-refresh polling (GeckoTerminal free tier is 30 calls/min) —
 * the user refreshes manually. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Flame, RefreshCw, Search, SlidersHorizontal, Sparkles, TrendingUp, X } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { fmtPct, fmtPrice } from '../../lib/format';
import {
  DISCOVER_CHAINS,
  applyDiscoverFilters,
  dedupeDiscoverTokens,
  fetchDiscoverPage,
  formatTokenAge,
  prettyDexId,
  searchTokens,
  sortDiscoverTokens,
  type DiscoverSort,
  type DiscoverTab,
  type DiscoverToken,
} from '../../lib/discover';
import { tokenDetailRoute } from '../../lib/tokenResolve';
import { EmptyState } from '../../components/ui';
import { TokenLogo } from '../../components/TokenLogo';
import { AppHeader } from '../../components/AppShell';

const TABS: { key: DiscoverTab; label: string; icon: React.ReactNode }[] = [
  { key: 'trending', label: 'Trending', icon: <Flame size={14} color={COLORS.amber} /> },
  { key: 'gainers', label: 'Gainers', icon: <TrendingUp size={14} color={COLORS.textMuted} /> },
  { key: 'new', label: 'New Pairs', icon: <Sparkles size={14} color={COLORS.textMuted} /> },
];

const TAB_DEFAULT_SORT: Record<DiscoverTab, DiscoverSort> = {
  trending: 'trending',
  gainers: 'gainers',
  new: 'newest',
};

const SORTS: { key: DiscoverSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'volume', label: 'Volume' },
  { key: 'marketcap', label: 'Market Cap' },
  { key: 'newest', label: 'Newest' },
  { key: 'gainers', label: 'Gainers' },
];

const AGE_CHOICES: { label: string; ms: number | null }[] = [
  { label: 'Any age', ms: null },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
];

function compactUsd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function parseMin(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

export default function Discover() {
  const [tab, setTab] = useState<DiscoverTab>('trending');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<DiscoverSort | null>(null);
  const [tokens, setTokens] = useState<DiscoverToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minLiq, setMinLiq] = useState('');
  const [minVol, setMinVol] = useState('');
  const [minMc, setMinMc] = useState('');
  const [maxAgeMs, setMaxAgeMs] = useState<number | null>(null);
  const [newOnly, setNewOnly] = useState(false);
  const [dexFilter, setDexFilter] = useState<string | null>(null);
  const reqId = useRef(0);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 768;

  /** Page 1 load (tab / chain / search change, manual refresh).
   *  Search is not paged — it uses the DexScreener search path. */
  const load = useCallback(async (tabV: DiscoverTab, chainV: string, q: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const searching = q.trim() !== '';
      if (searching) {
        const res = await searchTokens(q.trim());
        if (id !== reqId.current) return; // a newer load superseded this one
        setTokens(res.tokens);
        setSource(res.source);
        setError(res.error);
        setUpdatedAt(res.updatedAt);
        pageRef.current = 1;
        hasMoreRef.current = false; // search results are a single page
        setHasMore(false);
      } else {
        const res = await fetchDiscoverPage(tabV, chainV === 'all' ? 'all' : chainV, 1);
        if (id !== reqId.current) return; // a newer load superseded this one
        setTokens(res.tokens);
        setSource(res.source);
        setError(res.error);
        setUpdatedAt(res.updatedAt);
        pageRef.current = 1;
        hasMoreRef.current = res.hasMore;
        setHasMore(res.hasMore);
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setTokens([]);
      setSource(null);
      setError(e instanceof Error ? e.message : String(e));
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  /** Append the next page when the user scrolls near the bottom.
   *  Guarded by refs so a stale onScroll closure cannot double-fetch;
   *  stops when a page comes back empty or short (hasMore false). */
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMoreRef.current || debouncedQuery.trim()) return;
    const id = reqId.current;
    const nextPage = pageRef.current + 1;
    setLoadingMore(true);
    try {
      const res = await fetchDiscoverPage(tab, chainFilter === 'all' ? 'all' : chainFilter, nextPage);
      if (id !== reqId.current) return; // a fresh page-1 load superseded this
      setTokens((prev) => dedupeDiscoverTokens([...prev, ...res.tokens]));
      pageRef.current = nextPage;
      hasMoreRef.current = res.hasMore;
      setHasMore(res.hasMore);
      setSource(res.source);
      setUpdatedAt(res.updatedAt);
    } catch {
      // A failed page is not fatal — the loaded rows stay, and the
      // user can scroll again to retry.
    } finally {
      if (id === reqId.current) setLoadingMore(false);
    }
  }, [loading, loadingMore, tab, chainFilter, debouncedQuery]);

  // onScroll reads the latest loadMore without re-binding the handler.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) {
      void loadMoreRef.current();
    }
  }, []);

  // Debounced search (500ms); clearing the query reloads the tab.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 500);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    // Data fetch on tab / chain / search change — the same load-on-mount
    // pattern used throughout this codebase (see token detail, vault).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(tab, chainFilter, debouncedQuery);
  }, [tab, chainFilter, debouncedQuery, load]);

  const dexOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tokens) if (t.dexId) seen.add(t.dexId);
    return [...seen].sort();
  }, [tokens]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (parseMin(minLiq) !== null) n += 1;
    if (parseMin(minVol) !== null) n += 1;
    if (parseMin(minMc) !== null) n += 1;
    if (maxAgeMs !== null) n += 1;
    if (newOnly) n += 1;
    if (dexFilter) n += 1;
    return n;
  }, [minLiq, minVol, minMc, maxAgeMs, newOnly, dexFilter]);

  const visible = useMemo(() => {
    const filtered = applyDiscoverFilters(tokens, {
      minLiquidityUsd: parseMin(minLiq),
      minVolume24h: parseMin(minVol),
      minMarketCap: parseMin(minMc),
      maxAgeMs: newOnly ? 24 * 60 * 60 * 1000 : maxAgeMs,
      newOnly,
      dexId: dexFilter,
      chainId: chainFilter,
      query: debouncedQuery || undefined,
    });
    return sortDiscoverTokens(filtered, sort ?? TAB_DEFAULT_SORT[tab]);
  }, [tokens, minLiq, minVol, minMc, maxAgeMs, newOnly, dexFilter, chainFilter, debouncedQuery, sort, tab]);

  const showsFdvMc = useMemo(() => visible.some((t) => t.marketCapSource === 'fdv'), [visible]);

  const tabTitle =
    tab === 'trending' ? 'Trending' : tab === 'gainers' ? 'Gainers' : 'New Pairs';
  const tabSub =
    tab === 'trending'
      ? 'Most active DEX pools right now'
      : tab === 'gainers'
        ? 'Biggest 24h movers'
        : 'Newest pairs listed on DEXes';

  const changeTab = (next: DiscoverTab) => {
    setTab(next);
    setSort(null);
    setDexFilter(null);
  };

  const clearFilters = () => {
    setMinLiq('');
    setMinVol('');
    setMinMc('');
    setMaxAgeMs(null);
    setNewOnly(false);
    setDexFilter(null);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.inner,
          {
            paddingTop: 12 + insets.top,
            paddingBottom: 32 + insets.bottom,
            ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null),
          },
        ]}
      >
        <AppHeader />
        <View style={styles.head}>
          <View style={styles.headSide} />
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Discover</Text>
          <Pressable
            onPress={() => void load(tab, chainFilter, debouncedQuery)}
            style={styles.headSide}
            hitSlop={8}
            accessibilityLabel="Refresh"
          >
            <RefreshCw size={18} color={COLORS.text} />
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} style={styles.tab} onPress={() => changeTab(t.key)}>
              <View style={styles.tabLabel}>
                {t.icon}
                <Text
                  style={[styles.tabText, tab === t.key && styles.tabTextOn]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {t.label}
                </Text>
              </View>
              {tab === t.key ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlineOff} />}
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsInner}>
          <Pressable
            style={[styles.chip, chainFilter === 'all' && styles.chipOn]}
            onPress={() => setChainFilter('all')}
          >
            <Text style={[styles.chipText, chainFilter === 'all' && styles.chipTextOn]}>All chains</Text>
          </Pressable>
          {DISCOVER_CHAINS.map((c) => (
            <Pressable
              key={c.id}
              style={[styles.chip, chainFilter === c.id && styles.chipOn]}
              onPress={() => setChainFilter(c.id)}
            >
              <Text style={[styles.chipText, chainFilter === c.id && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.blockHead}>
          <View style={styles.blockIcon}>
            <Flame size={16} color={COLORS.amber} />
          </View>
          <View style={styles.blockMid}>
            <Text style={styles.blockTitle}>{tabTitle}</Text>
            <Text style={styles.blockSub}>{tabSub}</Text>
          </View>
          <View style={styles.countPill}>
            <Text style={styles.countText}>{visible.length} tokens</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Search size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.search}
            placeholder="Search symbol, name or contract address…"
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color={COLORS.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsInner}>
          {SORTS.map((s) => {
            const active = (sort ?? TAB_DEFAULT_SORT[tab]) === s.key;
            return (
              <Pressable key={s.key} style={[styles.chip, active && styles.chipOn]} onPress={() => setSort(s.key)}>
                <Text style={[styles.chipText, active && styles.chipTextOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.chip, styles.filterChip, filtersOpen && styles.chipOn]}
            onPress={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal size={13} color={filtersOpen ? '#fff' : COLORS.text} />
            <Text style={[styles.chipText, filtersOpen && styles.chipTextOn]}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </Pressable>
        </ScrollView>

        {filtersOpen ? (
          <View style={styles.filterPanel}>
            <Text style={styles.filterLabel}>Minimums (USD)</Text>
            <View style={styles.filterRow}>
              <View style={styles.filterField}>
                <Text style={styles.filterFieldLabel}>Liquidity</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="$0"
                  placeholderTextColor={COLORS.textMuted}
                  value={minLiq}
                  onChangeText={setMinLiq}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.filterField}>
                <Text style={styles.filterFieldLabel}>24h volume</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="$0"
                  placeholderTextColor={COLORS.textMuted}
                  value={minVol}
                  onChangeText={setMinVol}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.filterField}>
                <Text style={styles.filterFieldLabel}>Market cap</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="$0"
                  placeholderTextColor={COLORS.textMuted}
                  value={minMc}
                  onChangeText={setMinMc}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <Text style={styles.filterLabel}>Pair age</Text>
            <View style={styles.filterRow}>
              {AGE_CHOICES.map((a) => (
                <Pressable
                  key={a.label}
                  style={[styles.chip, maxAgeMs === a.ms && !newOnly && styles.chipOn]}
                  onPress={() => {
                    setMaxAgeMs(a.ms);
                    setNewOnly(false);
                  }}
                >
                  <Text style={[styles.chipText, maxAgeMs === a.ms && !newOnly && styles.chipTextOn]}>{a.label}</Text>
                </Pressable>
              ))}
              <Pressable
                style={[styles.chip, newOnly && styles.chipOn]}
                onPress={() => {
                  setNewOnly((v) => !v);
                  setMaxAgeMs(null);
                }}
              >
                <Text style={[styles.chipText, newOnly && styles.chipTextOn]}>New only (&lt;24h)</Text>
              </Pressable>
            </View>
            {dexOptions.length > 0 ? (
              <>
                <Text style={styles.filterLabel}>DEX</Text>
                <View style={styles.filterRow}>
                  <Pressable
                    style={[styles.chip, dexFilter === null && styles.chipOn]}
                    onPress={() => setDexFilter(null)}
                  >
                    <Text style={[styles.chipText, dexFilter === null && styles.chipTextOn]}>All DEXes</Text>
                  </Pressable>
                  {dexOptions.map((d) => (
                    <Pressable
                      key={d}
                      style={[styles.chip, dexFilter === d && styles.chipOn]}
                      onPress={() => setDexFilter(d)}
                    >
                      <Text style={[styles.chipText, dexFilter === d && styles.chipTextOn]}>{prettyDexId(d)}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            {activeFilterCount > 0 ? (
              <Pressable style={styles.clearBtn} onPress={clearFilters}>
                <Text style={styles.clearBtnText}>Clear all filters</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {source ? (
          <Text style={styles.source}>
            Source: {source}
            {updatedAt ? ` · Updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}
          </Text>
        ) : null}

        {loading ? (
          <Text style={styles.loading}>Loading tokens…</Text>
        ) : visible.length === 0 ? (
          <EmptyState
            title={debouncedQuery ? 'No tokens match that search' : 'No tokens found'}
            body={
              debouncedQuery
                ? 'Try a different symbol, name or contract address.'
                : activeFilterCount > 0
                  ? 'Try loosening the filters — nothing in this list passes them.'
                  : 'Tokens will appear here once the live feed returns data.'
            }
          />
        ) : (
          visible.map((t, i) => (
            <Pressable
              key={`${t.chainId}:${t.address}`}
              style={styles.row}
              onPress={() => router.push(tokenDetailRoute({ symbol: t.symbol, address: t.address, chainId: t.chainId }))}
            >
              <Text style={styles.rank}>{i + 1}</Text>
              <TokenLogo chainId={t.chainId} address={t.address} symbol={t.symbol} size={38} logoUrl={t.iconUrl} fallbackTone="light" />
              <View style={styles.mid}>
                <View style={styles.line}>
                  <Text style={styles.name} numberOfLines={1}>
                    {t.symbol}
                  </Text>
                  <Text style={[styles.cell, styles.cellRight]} numberOfLines={1}>{t.priceUsd === null ? '—' : fmtPrice(t.priceUsd)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={styles.sub} numberOfLines={1}>
                    {t.name && t.name !== t.symbol ? `${t.name} · ` : ''}
                    {prettyDexId(t.dexId)} · {formatTokenAge(t.pairCreatedAt)}
                  </Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.cellRight,
                      {
                        color:
                          t.change24h === null ? COLORS.textMuted : t.change24h >= 0 ? COLORS.mintDark : COLORS.red,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {t.change24h === null ? '—' : fmtPct(t.change24h)}
                  </Text>
                </View>
                <Text style={styles.stats} numberOfLines={1}>
                  MC {compactUsd(t.marketCap)} · Vol {compactUsd(t.volume24h)} · Liq {compactUsd(t.liquidityUsd)}
                </Text>
              </View>
            </Pressable>
          ))
        )}
        {loadingMore ? <Text style={styles.loading}>Loading more…</Text> : null}
        {showsFdvMc ? (
          <Text style={styles.footnote}>* MC shows FDV where the feed does not report a market cap yet.</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  blockHead: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 },
  blockIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.amberSoft,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  blockMid: { flex: 1, minWidth: 0 },
  blockSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  blockTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  cell: { color: COLORS.text, flexShrink: 0, fontSize: 12, fontWeight: '700' },
  cellRight: { textAlign: 'right' },
  chip: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: COLORS.navy },
  chipText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  chips: { marginTop: 10 },
  chipsInner: { gap: 6, paddingRight: 4 },
  clearBtn: { alignSelf: 'flex-start', marginTop: 10 },
  clearBtnText: { color: COLORS.red, fontSize: 12, fontWeight: '700' },
  countPill: { backgroundColor: COLORS.amberSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  countText: { color: '#B45309', fontSize: 11, fontWeight: '700' },
  error: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 10 },
  filterChip: { gap: 5 },
  filterField: { flex: 1 },
  filterFieldLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  filterInput: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  filterLabel: { color: COLORS.text, fontSize: 12, fontWeight: '800', marginBottom: 6, marginTop: 10 },
  filterPanel: {
    backgroundColor: COLORS.bgMuted,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footnote: { color: COLORS.textMuted, fontSize: 11, marginTop: 10 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headSide: { alignItems: 'center', width: 32 },
  inner: { padding: 12 },
  line: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  loading: { color: COLORS.textMuted, fontSize: 12, marginTop: 20, textAlign: 'center' },
  mid: { flex: 1, gap: 2, minWidth: 0 },
  name: { color: COLORS.text, flex: 1, fontSize: 14, fontWeight: '700' },
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
  stats: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  sub: { color: COLORS.textMuted, flex: 1, fontSize: 11, marginTop: 2, minWidth: 0 },
  tab: { flex: 1, minWidth: 0 },
  tabLabel: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center', minWidth: 0, paddingVertical: 8 },
  tabText: { color: COLORS.textMuted, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  tabTextOn: { color: COLORS.text },
  tabUnderline: { backgroundColor: COLORS.amber, height: 3, borderRadius: 2 },
  tabUnderlineOff: { height: 3 },
  tabs: { borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', marginTop: 8 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
