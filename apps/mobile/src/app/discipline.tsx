/** Screen 18 — Discipline Report: score, streak, locked ratio, monthly
 *  summary. Compact v1 sizes (score 28px). Empty state when no locks exist
 *  yet. No guaranteed-profit wording. */
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtUsd } from '../lib/format';
import { disciplineScore } from '../lib/vault';
import { Btn, Card, EmptyState, ProgressBar, RiskNote, SectionTitle } from '../components/ui';

export default function Discipline() {
  const { discipline, locks } = useApp();
  const score = disciplineScore({
    lockedRatio: discipline.lockedRatio,
    streakDays: discipline.streakDays,
    locksCompleted: discipline.locksCompleted,
    locksBroken: discipline.locksBroken,
  });
  const active = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold').length;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Discipline Report</Text>

      <Card dark style={styles.scoreCard}>
        <Text style={styles.label}>Discipline Score</Text>
        <Text style={styles.score}>
          {score}
          <Text style={styles.scoreOf}> / 100</Text>
        </Text>
        <ProgressBar value={score / 100} />
        <Text style={styles.streak}>
          {discipline.streakDays}-day streak · {active} active lock{active === 1 ? '' : 's'}
        </Text>
      </Card>

      <SectionTitle title="This Month" />
      <Card>
        <Stat label="Locked this month" value={fmtUsd(discipline.monthLockedUsd)} />
        <Stat label="Auto-sold to stablecoin" value={fmtUsd(discipline.monthAutoSoldUsd)} />
        <Stat label="Total auto-sold (all time)" value={fmtUsd(discipline.totalAutoSoldUsd)} />
        <Stat label="Locked ratio" value={`${Math.round(discipline.lockedRatio * 100)}% of portfolio`} />
        <Stat label="Locks completed" value={String(discipline.locksCompleted)} />
        <Stat label="Locks broken early" value={String(discipline.locksBroken)} />
      </Card>

      {locks.length === 0 ? (
        <EmptyState
          title="No locks yet"
          body="Your discipline score grows as you lock funds and hold to plan."
          actionLabel="Open Vault"
          onAction={() => router.push('/(tabs)/vault')}
        />
      ) : null}

      <Btn
        label="Share My Discipline Card"
        variant="mint"
        onPress={() =>
          Alert.alert(
            'Share card',
            `Discipline Score ${score}/100 · ${discipline.streakDays}-day streak · ${Math.round(discipline.lockedRatio * 100)}% locked · ${fmtUsd(discipline.totalAutoSoldUsd)} auto-sold to stablecoin.`,
          )
        }
        style={styles.shareBtn}
      />
      <RiskNote text="Your score rewards holding to plan. Breaking a lock early lowers it. Stelix never guarantees profit — it enforces the plan you set." />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 12 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  score: { color: '#fff', fontSize: 28, fontWeight: '800', marginVertical: 6 },
  scoreCard: { marginTop: 12, padding: 14 },
  scoreOf: { color: COLORS.textOnNavyMuted, fontSize: 14 },
  shareBtn: { marginTop: 14 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { color: COLORS.textMuted, fontSize: 12 },
  statValue: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  streak: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 8 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
