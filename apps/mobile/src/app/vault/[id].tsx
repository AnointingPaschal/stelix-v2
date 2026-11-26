/** Screen 14 — Lock Detail: countdown, target progress, ladder checklist, claim / break. */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { demoChartSeries, demoToken } from '../../lib/demoData';
import { fmtDateTime, fmtNum, fmtPrice, fmtUsd, timeLeft } from '../../lib/format';
import { getChain } from '../../lib/chains';
import {
  breakPenaltyTokens,
  isTrailingStopBreached,
  lockSummarySentence,
  targetProgress,
} from '../../lib/vault';
import { Btn, Card, Chip, DemoBadge, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';

export default function LockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locks, updateLock, addTx } = useApp();
  const lock = locks.find((l) => l.id === id);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000); // live countdown
    return () => clearInterval(t);
  }, []);

  if (!lock) {
    return (
      <View style={styles.missing}>
        <Text style={styles.title}>Lock not found</Text>
        <Btn label="Back to Vault" onPress={() => router.replace('/(tabs)/vault')} />
      </View>
    );
  }

  const token = demoToken(lock.tokenSymbol);
  const currentPrice = token.price;
  const progress = lock.targetPrice ? targetProgress(lock, currentPrice) : 0;
  const value = lock.amountRemaining * currentPrice;
  const chain = getChain(lock.chainId);
  const matured = Date.now() >= lock.unlockTime;
  const anyTargetHit = lock.ladder.some((s) => s.status === 'sold');
  const trailingBreached = isTrailingStopBreached(lock, currentPrice, anyTargetHit);
  let penalty = 0;
  let penaltyError = '';
  try {
    penalty = breakPenaltyTokens(lock, Date.now(), currentPrice);
  } catch (e) {
    penaltyError = String(e);
  }

  function claim() {
    if (!lock) return;
    updateLock({ ...lock, status: 'completed', amountRemaining: 0 });
    addTx({
      id: `tx-${Date.now()}`, kind: 'unlock', token: lock.tokenSymbol,
      amount: lock.amountRemaining, usd: value,
      note: `Lock matured — claimed ${fmtNum(lock.amountRemaining)} ${lock.tokenSymbol}`,
      at: Date.now(), status: 'confirmed',
    });
    Alert.alert('Claimed (DEMO)', `${fmtNum(lock.amountRemaining)} ${lock.tokenSymbol} returned to your wallet.`);
  }

  function requestBreak() {
    if (!lock) return;
    if (lock.breakMode === 'immutable') {
      Alert.alert('Immutable lock', 'This lock cannot be broken early. It unlocks on its date or its price target.');
      return;
    }
    Alert.alert(
      'Break this lock?',
      penalty > 0
        ? `Early break costs ${fmtNum(penalty)} ${lock.tokenSymbol} (${lock.penaltyBps / 100}% penalty) after a 24-hour cooling-off period. The penalty is waived only when a target or the date triggers the exit.`
        : 'This break has no token penalty, but it still needs the cooling-off period and your Discipline PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start cooling-off',
          style: 'destructive',
          onPress: () => {
            addTx({ id: `tx-${Date.now()}`, kind: 'unlock', token: lock.tokenSymbol, amount: 0, usd: 0, note: `Break requested for ${lock.id} — 24h cooling-off started`, at: Date.now(), status: 'pending' });
            Alert.alert('Cooling-off started (DEMO)', 'You can complete the break after 24 hours. Use the time to reconsider.');
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>{lock.id}</Text>
        <DemoBadge />
      </View>
      <Text style={styles.sub}>
        {fmtNum(lock.amountRemaining)} {lock.tokenSymbol} · {chain.name} · {lock.status.replace('-', ' ')}
      </Text>

      <Card dark>
        <Text style={styles.label}>Current value</Text>
        <Text style={styles.value}>{fmtUsd(value)}</Text>
        <Text style={styles.countdown}>
          {matured ? 'Matured — claim available' : `Unlocks in ${timeLeft(lock.unlockTime - Date.now())}`}
        </Text>
        <Text style={styles.date}>{fmtDateTime(lock.unlockTime)}</Text>
      </Card>

      {lock.targetPrice && (
        <>
          <SectionTitle title="Target progress" />
          <Card>
            <View style={styles.targetRow}>
              <Text style={styles.targetText}>Entry {fmtPrice(lock.entryPrice)}</Text>
              <Text style={styles.targetText}>Now {fmtPrice(currentPrice)}</Text>
              <Text style={styles.targetText}>Target {fmtPrice(lock.targetPrice)}</Text>
            </View>
            <ProgressBar value={progress} />
            <Text style={styles.progressLabel}>{Math.round(progress * 100)}% to {lock.targetMultiple}x target</Text>
            <Text style={styles.hint}>
              Trigger uses the 30-minute average price (TWAP), not a single tick — a one-minute wick cannot fire the exit.
            </Text>
            {lock.trailingStopBps !== null && (
              <Text style={[styles.hint, trailingBreached && styles.breach]}>
                Trailing stop {lock.trailingStopBps / 100}% · peak {fmtPrice(lock.peakPrice)} ·{' '}
                {trailingBreached ? 'BREACHED — remainder auto-sells.' : anyTargetHit ? 'Armed.' : 'Arms after the first target hit.'}
              </Text>
            )}
          </Card>
        </>
      )}

      <SectionTitle title="Locked position" />
      <PriceChart series={demoChartSeries(lock.tokenSymbol)} height={140} />

      {lock.ladder.length > 0 && (
        <>
          <SectionTitle title="Profit ladder" />
          <Card>
            {lock.ladder.map((s) => (
              <View key={s.multiple} style={styles.stageRow}>
                <Chip label={s.status === 'sold' ? 'Sold' : 'Pending'} tone={s.status === 'sold' ? 'mint' : 'muted'} />
                <Text style={styles.stageText}>
                  {s.percent}% at {s.multiple}x ({fmtPrice(lock.entryPrice * s.multiple)})
                </Text>
                <Text style={styles.stageUsd}>{s.soldUsd ? fmtUsd(s.soldUsd) : '—'}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle title="Lock terms" />
      <Card>
        <Term label="Break mode" value={lock.breakMode === 'immutable' ? 'Immutable — no early break' : lock.breakMode === 'penalty' ? `Penalty break — ${lock.penaltyBps / 100}% after 24h cooling-off` : 'Guardian break — approval + 48h delay'} />
        <Term label="Auto-sell" value={lock.autoSell ? `On — ${chain.exitStablecoinLabel}` : 'Off — unlock to wallet'} />
        <Term label="Slippage" value={`${lock.slippageBps / 100}%`} />
        <Term label="Minimum receive" value={fmtUsd(lock.minReceiveUsd)} />
        <Term label="Contract" value={chain.vaultContract ?? 'Not deployed yet (testnet first)'} />
        <Term label="Tx hash" value={lock.txHash ? `${lock.txHash.slice(0, 12)}…${lock.txHash.slice(-6)}` : '—'} />
        <Text style={styles.sentence}>{lockSummarySentence(lock, chain.exitStablecoinLabel)}</Text>
      </Card>

      <View style={styles.actions}>
        {matured && lock.status !== 'completed' && (
          <Btn label="Claim" variant="mint" onPress={claim} style={styles.actionBtn} />
        )}
        {lock.status === 'completed' ? (
          <Chip label="Completed" tone="mint" />
        ) : (
          <Btn
            label={penaltyError ? 'Break Lock (not allowed)' : 'Break Lock'}
            variant="danger"
            onPress={requestBreak}
            disabled={!!penaltyError}
            style={styles.actionBtn}
          />
        )}
        <Btn label="Share Receipt" variant="ghost" onPress={() => Alert.alert('Receipt (DEMO)', `${lock.id} · ${fmtNum(lock.amount)} ${lock.tokenSymbol} · ${chain.name}`)} style={styles.actionBtn} />
      </View>
      <RiskNote />
    </ScrollView>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{label}</Text>
      <Text style={styles.termValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  breach: { color: COLORS.red, fontWeight: '700' },
  countdown: { color: COLORS.mint, fontSize: 15, fontWeight: '800', marginTop: 8 },
  date: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 4 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 20 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 13, fontWeight: '700' },
  missing: { backgroundColor: COLORS.bg, flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  progressLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sentence: { color: COLORS.text, fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 12 },
  stageRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 8 },
  stageText: { color: COLORS.text, flex: 1, fontSize: 14, fontWeight: '700' },
  stageUsd: { color: COLORS.textMuted, fontSize: 13 },
  sub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  targetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  targetText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  termLabel: { color: COLORS.textMuted, fontSize: 13 },
  termRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  termValue: { color: COLORS.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  value: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 4 },
});
