/** Screen 18 — Discipline Report, redesigned as a Wallet Vault: navy hero
 *  with a circular score gauge ring, This Month figures as a tile grid,
 *  and locks as vault compartments (LockCard, as on the Vault screen).
 *  Presentation only — every data point and behaviour is unchanged from
 *  v1 (same score, streak, stats, Open Vault and Share actions).
 *
 *  "Share My Discipline Card" copies the card text to the clipboard and
 *  confirms inline — the old Alert.alert was a no-op on web, so the
 *  button looked dead. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Flame, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtUsd } from '../lib/format';
import { disciplineScore } from '../lib/vault';
import { Btn, Card, EmptyState, ScreenHeader, SectionTitle, centeredContent } from '../components/ui';
import { AppHeader, BottomNav } from '../components/AppShell';
import { LockCard } from '../components/TokenRow';

const GAUGE_SIZE = 168;
const GAUGE_R = 70;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

export default function Discipline() {
  const { discipline, locks, tokens } = useApp();
  const insets = useSafeAreaInsets();

  const [copied, setCopied] = useState(false);
  const score = disciplineScore({
    lockedRatio: discipline.lockedRatio,
    streakDays: discipline.streakDays,
    locksCompleted: discipline.locksCompleted,
    locksBroken: discipline.locksBroken,
  });
  const active = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold').length;
  // Live price from the store (null = no live price — falls back to the
  // lock's entry price, exactly as the Vault screen does).
  const priceOf = (symbol: string) => tokens.find((t) => t.symbol === symbol)?.price ?? null;

  const stats: { label: string; value: string }[] = [
    { label: 'Locked this month', value: fmtUsd(discipline.monthLockedUsd) },
    { label: 'Auto-sold to stablecoin', value: fmtUsd(discipline.monthAutoSoldUsd) },
    { label: 'Total auto-sold (all time)', value: fmtUsd(discipline.totalAutoSoldUsd) },
    { label: 'Locked ratio', value: `${Math.round(discipline.lockedRatio * 100)}% of portfolio` },
    { label: 'Locks completed', value: String(discipline.locksCompleted) },
    { label: 'Locks broken early', value: String(discipline.locksBroken) },
  ];

  return (
    <View style={styles.shell}>
      <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <AppHeader showBack />
        <ScreenHeader title="Discipline Report" />

        <Card dark style={styles.vaultCard}>
          <Text style={styles.vaultLabel}>Discipline Score</Text>
          <View style={styles.gaugeWrap}>
            <Svg width={GAUGE_SIZE} height={GAUGE_SIZE}>
              <Circle cx={GAUGE_SIZE / 2} cy={GAUGE_SIZE / 2} r={GAUGE_R} stroke={COLORS.navySoft} strokeWidth={10} fill="none" />
              <Circle
                cx={GAUGE_SIZE / 2}
                cy={GAUGE_SIZE / 2}
                r={GAUGE_R}
                stroke={COLORS.mint}
                strokeWidth={10}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${(score / 100) * GAUGE_C} ${GAUGE_C}`}
                transform={`rotate(-90 ${GAUGE_SIZE / 2} ${GAUGE_SIZE / 2})`}
              />
            </Svg>
            <View style={styles.gaugeCentre}>
              <Text style={styles.score}>
                {score}
                <Text style={styles.scoreOf}> / 100</Text>
              </Text>
              <Text style={styles.gaugeSub}>out of 100</Text>
            </View>
          </View>
          <View style={styles.vaultStats}>
            <View style={styles.vaultStat}>
              <View style={styles.vaultIcon}>
                <Flame size={16} color={COLORS.mint} />
              </View>
              <Text style={styles.vaultStatValue}>{discipline.streakDays}-day streak</Text>
            </View>
            <View style={styles.vaultDivider} />
            <View style={styles.vaultStat}>
              <View style={styles.vaultIcon}>
                <Lock size={16} color={COLORS.mint} />
              </View>
              <Text style={styles.vaultStatValue}>
                {active} active lock{active === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
        </Card>

        <SectionTitle title="This Month" />
        <View style={styles.tileGrid}>
          {stats.map((s) => (
            <View key={s.label} style={styles.tile}>
              <Text style={styles.tileLabel}>{s.label}</Text>
              <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
            </View>
          ))}
        </View>

        {locks.length === 0 ? (
          <EmptyState
            title="No locks yet"
            body="Your discipline score grows as you lock funds and hold to plan."
            actionLabel="Open Vault"
            onAction={() => router.push('/(tabs)/vault')}
          />
        ) : (
          <>
            <SectionTitle title="Vault Compartments" />
            {locks.map((l) => (
              <LockCard key={l.id} lock={l} currentPrice={priceOf(l.tokenSymbol) ?? l.entryPrice} onPress={() => router.push(`/vault/${l.id}`)} />
            ))}
          </>
        )}

        <Btn
          label={copied ? 'Card Copied' : 'Share My Discipline Card'}
          variant="mint"
          onPress={() => {
            void Clipboard.setStringAsync(
              `Stelix Discipline Score ${score}/100 · ${discipline.streakDays}-day streak · ${Math.round(discipline.lockedRatio * 100)}% locked · ${fmtUsd(discipline.totalAutoSoldUsd)} auto-sold to stablecoin.`,
            ).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          style={styles.shareBtn}
        />
        {copied ? <Text style={styles.copied}>Card text copied — paste it anywhere to share.</Text> : null}
      </ScrollView>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  copied: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  gaugeCentre: { alignItems: 'center', height: '100%', justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  gaugeSub: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 2 },
  gaugeWrap: { alignItems: 'center', alignSelf: 'center', height: GAUGE_SIZE, justifyContent: 'center', marginTop: 12, width: GAUGE_SIZE },
  inner: { padding: 12 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  score: { color: '#fff', fontSize: 30, fontWeight: '800' },
  scoreOf: { color: COLORS.textOnNavyMuted, fontSize: 14 },
  shareBtn: { marginTop: 14 },
  shell: { backgroundColor: COLORS.bg, flex: 1 },
  tile: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    width: '48%',
  },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  tileLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  tileValue: { color: COLORS.text, fontSize: 14, fontWeight: '800', marginTop: 4 },
  vaultCard: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
    shadowColor: COLORS.mint,
    shadowOpacity: 0.18,
  },
  vaultDivider: { backgroundColor: COLORS.navySoft, height: 32, marginTop: 12, width: 1 },
  vaultIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navySoft,
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  vaultLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  vaultStat: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12 },
  vaultStatValue: { color: '#fff', fontSize: 12, fontWeight: '800' },
  vaultStats: {
    alignItems: 'center',
    borderTopColor: COLORS.navySoft,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: 14,
  },
});
