/** Screen 18 — Discipline Report: score, streak, locked ratio, monthly summary, shareable card. */
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtUsd } from '../lib/format';
import { disciplineScore } from '../lib/vault';
import { Btn, Card, DemoBadge, ProgressBar, RiskNote, SectionTitle } from '../components/ui';

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
      <View style={styles.head}>
        <Text style={styles.title}>Discipline Report</Text>
        <DemoBadge />
      </View>

      <Card dark>
        <Text style={styles.label}>Discipline Score</Text>
        <Text style={styles.score}>{score}<Text style={styles.scoreOf}> / 100</Text></Text>
        <ProgressBar value={score / 100} />
        <Text style={styles.streak}>{discipline.streakDays}-day streak · {active} active locks</Text>
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

      <Btn
        label="Share My Discipline Card"
        variant="mint"
        onPress={() =>
          Alert.alert(
            'Share card (DEMO)',
            `Discipline Score ${score}/100 · ${discipline.streakDays}-day streak · ${Math.round(discipline.lockedRatio * 100)}% locked · ${fmtUsd(discipline.totalAutoSoldUsd)} auto-sold to stablecoin.`,
          )
        }
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
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 13, fontWeight: '700' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  score: { color: '#fff', fontSize: 44, fontWeight: '800', marginVertical: 6 },
  scoreOf: { color: COLORS.textOnNavyMuted, fontSize: 18 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  statLabel: { color: COLORS.textMuted, fontSize: 14 },
  statValue: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  streak: { color: COLORS.textOnNavyMuted, fontSize: 13, marginTop: 8 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
});
