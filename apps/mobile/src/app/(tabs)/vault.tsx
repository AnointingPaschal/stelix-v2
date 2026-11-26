/** Screen 12 — Vault (v1): centred title + refresh, navy Total Locked
 *  Value card with Tokens / Matured / Active mini-stats and a white
 *  Refresh Positions button, Lock / Wait / Unlock explainer cards, then
 *  Active Locks grouped by token. Empty state: "No locks yet". */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, Lock, RefreshCw, Unlock } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, fmtUsd } from '../../lib/format';
import { Btn, Card, EmptyState, RiskNote, SectionTitle, centeredContent } from '../../components/ui';
import { LockCard } from '../../components/TokenRow';

export default function VaultHub() {
  const { locks, tokens, refreshLocks, vaultNote } = useApp();
  const insets = useSafeAreaInsets();

  const [refreshing, setRefreshing] = useState(false);
  // Live price from the store (null = no live price — contributes $0, never
  // a placeholder price).
  const priceOf = (symbol: string) => tokens.find((t) => t.symbol === symbol)?.price ?? null;
  const active = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold');
  const matured = locks.filter((l) => l.status === 'matured' || (l.status !== 'completed' && l.status !== 'broken' && Date.now() >= l.unlockTime));
  const done = locks.filter((l) => l.status === 'completed' || l.status === 'broken');
  const totalLocked = [...active, ...matured].reduce((s, l) => s + l.amountRemaining * (priceOf(l.tokenSymbol) ?? 0), 0);
  const tokenCount = new Set(locks.map((l) => l.tokenSymbol)).size;

  // Group active + matured locks by token, as in v1 ("Active Locks (2 tokens)").
  const grouped = new Map<string, typeof locks>();
  [...active, ...matured].forEach((l) => {
    const g = grouped.get(l.tokenSymbol) ?? [];
    g.push(l);
    grouped.set(l.tokenSymbol, g);
  });

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshLocks();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
      <View style={styles.head}>
        <View style={styles.headSide} />
        <Text style={styles.title}>Vault</Text>
        <Pressable onPress={refresh} style={styles.headSide} hitSlop={8}>
          <RefreshCw size={18} color={COLORS.text} />
        </Pressable>
      </View>

      <Card dark style={styles.totalCard}>
        <View style={styles.totalHead}>
          <View style={styles.totalIcon}>
            <Lock size={18} color="#fff" />
          </View>
          <View>
            <Text style={styles.totalLabel}>Total Locked Value</Text>
            <Text style={styles.total}>{fmtUsd(totalLocked)}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.miniStats}>
          <View style={styles.miniStat}>
            <Text style={styles.miniLabel}>Tokens</Text>
            <Text style={styles.miniValue}>{tokenCount}</Text>
          </View>
          <View style={styles.miniStat}>
            <Text style={styles.miniLabel}>Matured</Text>
            <Text style={styles.miniValue}>{matured.length}</Text>
          </View>
          <View style={styles.miniStat}>
            <Text style={styles.miniLabel}>Active</Text>
            <Text style={styles.miniValue}>{active.length}</Text>
          </View>
        </View>
        <Btn
          label={refreshing ? 'Refreshing…' : 'Refresh Positions'}
          variant="secondary"
          onPress={refresh}
          loading={refreshing}
          style={styles.refreshBtn}
        />
      </Card>

      <View style={styles.steps}>
        <Step icon={<Lock size={16} color={COLORS.text} />} t="Lock" d="Choose token & duration" />
        <Step icon={<Clock size={16} color={COLORS.text} />} t="Wait" d="Contract holds funds on-chain" />
        <Step icon={<Unlock size={16} color={COLORS.text} />} t="Unlock" d="Withdraw when matured" />
      </View>

      <SectionTitle title={`Active Locks (${tokenCount} token${tokenCount === 1 ? '' : 's'})`} />
      {grouped.size === 0 ? (
        <EmptyState
          title="No locks yet"
          body="Create your first lock from a token — pick a date, a price target, or both."
          actionLabel="Create Lock"
          onAction={() => router.push('/vault/create')}
        />
      ) : (
        [...grouped.entries()].map(([symbol, ls]) => (
          <View key={symbol}>
            {ls.map((l) => (
              <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol) ?? l.entryPrice} onPress={() => router.push(`/vault/${l.id}`)} />
            ))}
            <Text style={styles.groupNote}>
              {symbol} · {ls.length} lock{ls.length > 1 ? 's' : ''} · {fmtNum(ls.reduce((s, l) => s + l.amountRemaining, 0), 4)} total
            </Text>
          </View>
        ))
      )}

      {done.length > 0 && (
        <>
          <SectionTitle title="Completed" />
          {done.map((l) => (
            <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol) ?? l.entryPrice} onPress={() => router.push(`/vault/${l.id}`)} />
          ))}
        </>
      )}
      <Btn label="Create Lock" variant="mint" onPress={() => router.push('/vault/create')} style={styles.createBtn} />
      {vaultNote ? <Text style={styles.vaultNote}>{vaultNote}</Text> : null}
      <RiskNote />
    </ScrollView>
  );
}

function Step({ icon, t, d }: { icon: React.ReactNode; t: string; d: string }) {
  return (
    <View style={styles.step}>
      {icon}
      <Text style={styles.stepTitle}>{t}</Text>
      <Text style={styles.stepDesc}>{d}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  createBtn: { marginTop: 12 },
  divider: { backgroundColor: COLORS.navySoft, height: 1, marginVertical: 10 },
  groupNote: { color: COLORS.textMuted, fontSize: 11, marginBottom: 10, marginTop: -4 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headSide: { alignItems: 'center', width: 32 },
  inner: { padding: 12 },
  miniLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  miniStat: { backgroundColor: COLORS.navySoft, borderRadius: 12, flex: 1, padding: 10 },
  miniStats: { flexDirection: 'row', gap: 8 },
  miniValue: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  refreshBtn: { backgroundColor: '#fff', marginTop: 12 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  step: {
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    padding: 10,
  },
  stepDesc: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15 },
  stepTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  steps: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  total: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  totalCard: { marginTop: 12, padding: 14 },
  vaultNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10, textAlign: 'center' },
  totalHead: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  totalIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  totalLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
});
