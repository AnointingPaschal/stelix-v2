/** Screen 12 — Vault Hub: total locked value, target progress, lock list, Create Lock. */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Lock, Plus } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtUsd } from '../../lib/format';
import { Btn, Card, DemoBadge, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { LockCard } from '../../components/TokenRow';
import { demoToken } from '../../lib/demoData';

export default function VaultHub() {
  const { locks, tokens } = useApp();
  const priceOf = (symbol: string) => demoToken(symbol).price;
  const active = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold');
  const matured = locks.filter((l) => l.status === 'matured');
  const done = locks.filter((l) => l.status === 'completed' || l.status === 'broken');
  const totalLocked = locks
    .filter((l) => l.status === 'active' || l.status === 'partially-sold' || l.status === 'matured')
    .reduce((s, l) => s + l.amountRemaining * priceOf(l.tokenSymbol), 0);
  const closest = [...active].sort((a, b) => a.unlockTime - b.unlockTime)[0];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Vault</Text>
        <DemoBadge />
      </View>

      <Card dark>
        <Text style={styles.label}>Total Locked Value</Text>
        <Text style={styles.total}>{fmtUsd(totalLocked)}</Text>
        <Text style={styles.meta}>
          {active.length} active · {matured.length} matured / claimable · {done.length} completed
        </Text>
        {closest && (
          <>
            <ProgressBar value={closest.targetPrice ? Math.min(1, priceOf(closest.tokenSymbol) / closest.targetPrice) : 0} />
            <Text style={styles.closest}>
              Closest: {closest.tokenSymbol} — {closest.targetMultiple ? `${closest.targetMultiple}x target` : 'date lock'} ·{' '}
              {new Date(closest.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </>
        )}
      </Card>

      <View style={styles.steps}>
        <Step n="1" t="Lock" d="Choose token, amount, date and price target." />
        <Step n="2" t="Hold" d="Funds leave your spendable balance until the plan is met." />
        <Step n="3" t="Exit" d="Date reached: unlock. Target reached: auto-sell to stablecoin." />
      </View>

      <Btn label="Create Lock" onPress={() => router.push('/vault/create')} variant="mint" />
      <View style={styles.spacer} />

      <SectionTitle title="Active Locks" />
      {active.length === 0 && <Text style={styles.empty}>No active locks yet. Create your first Bull Lock.</Text>}
      {active.map((l) => (
        <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol)} onPress={() => router.push(`/vault/${l.id}`)} />
      ))}

      {matured.length > 0 && (
        <>
          <SectionTitle title="Matured — Claimable" />
          {matured.map((l) => (
            <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol)} onPress={() => router.push(`/vault/${l.id}`)} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle title="Completed" />
          {done.map((l) => (
            <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol)} onPress={() => router.push(`/vault/${l.id}`)} />
          ))}
        </>
      )}
      <RiskNote />
    </ScrollView>
  );
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepTitle}>{t}</Text>
      <Text style={styles.stepDesc}>{d}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  closest: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 8 },
  empty: { color: COLORS.textMuted, fontSize: 14 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 13, fontWeight: '700' },
  meta: { color: COLORS.textOnNavyMuted, fontSize: 13, marginBottom: 12, marginTop: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spacer: { height: 8 },
  step: { flex: 1 },
  stepDesc: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  stepNum: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepNumText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stepTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800', marginTop: 8 },
  steps: { flexDirection: 'row', gap: 12, marginVertical: 16 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  total: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 4 },
});
