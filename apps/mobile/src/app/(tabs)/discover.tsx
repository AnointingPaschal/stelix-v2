/** Screen 11 — Discover: Trending / Gainers / Top Tokens per chain, safety chips. */
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { Btn, Chip, DemoBadge } from '../../components/ui';

type Tab = 'trending' | 'gainers' | 'top';

export default function Discover() {
  const { tokens, chain } = useApp();
  const [tab, setTab] = useState<Tab>('trending');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const base = tokens.filter((t) => !t.isSpam);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? base.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q))
      : base;
    if (tab === 'gainers') return [...filtered].sort((a, b) => b.change24h - a.change24h);
    if (tab === 'top') return [...filtered].sort((a, b) => b.marketCap - a.marketCap);
    return [...filtered].sort((a, b) => b.volume24h - a.volume24h);
  }, [tokens, tab, query]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Discover</Text>
        <DemoBadge />
      </View>
      <Text style={styles.chain}>{chain.name} · safety scores are independent of any listing</Text>
      <TextInput
        style={styles.search}
        placeholder="Search symbol, name or contract address"
        value={query}
        onChangeText={setQuery}
      />
      <View style={styles.tabs}>
        {(['trending', 'gainers', 'top'] as Tab[]).map((t) => (
          <Btn
            key={t}
            label={t === 'top' ? 'Top Tokens' : t[0].toUpperCase() + t.slice(1)}
            variant={tab === t ? 'primary' : 'ghost'}
            onPress={() => setTab(t)}
            style={styles.tabBtn}
          />
        ))}
      </View>
      {list.map((t) => (
        <View key={t.symbol} style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{t.symbol.slice(0, 2)}</Text>
          </View>
          <View style={styles.mid}>
            <Text style={styles.name}>{t.symbol} <Text style={styles.sub}>· {t.name}</Text></Text>
            <Text style={styles.sub}>
              {fmtPrice(t.price)} · Liq {fmtUsd(t.liquidity, 0)}
            </Text>
          </View>
          <View style={styles.right}>
            <Text style={[styles.change, { color: t.change24h >= 0 ? COLORS.mintDark : COLORS.red }]}>
              {fmtPct(t.change24h)}
            </Text>
            <Chip label={`Safety ${t.safetyScore}`} tone={t.safetyScore >= 80 ? 'mint' : t.safetyScore >= 60 ? 'amber' : 'red'} />
          </View>
          <Btn label="View" variant="ghost" onPress={() => router.push(`/token/${t.symbol}`)} style={styles.viewBtn} />
        </View>
      ))}
      {list.length === 0 && <Text style={styles.empty}>No tokens match that search.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  chain: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  change: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  empty: { color: COLORS.textMuted, marginTop: 20, textAlign: 'center' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  mid: { flex: 1 },
  name: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  right: { alignItems: 'flex-end', gap: 4 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  search: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    fontSize: 15,
    marginTop: 14,
    padding: 12,
  },
  sub: { color: COLORS.textMuted, fontSize: 12, fontWeight: '400', marginTop: 2 },
  tabBtn: { flex: 1, minHeight: 40, paddingHorizontal: 8 },
  tabs: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  viewBtn: { minHeight: 36, paddingHorizontal: 10 },
});
