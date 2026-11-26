/** Screen 14 — Lock Detail: countdown, target progress, ladder checklist,
 *  claim / break. Compact v1 sizes. */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fetchCandles, fetchTokenMarketData, type Candle } from '../../lib/prices';
import { fmtDateTime, fmtNum, fmtPrice, fmtUsd, timeLeft } from '../../lib/format';
import { getChain } from '../../lib/chains';
import {
  breakPenaltyTokens,
  isTrailingStopBreached,
  lockSummarySentence,
  targetProgress,
} from '../../lib/vault';
import { Btn, Card, Chip, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';

export default function LockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locks, tokens, updateLock, addTx } = useApp();
  const lock = locks.find((l) => l.id === id);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000); // live countdown
    return () => clearInterval(t);
  }, []);

  // Live price + real candles for the locked token (store price first,
  // DexScreener market data as fallback; "—" when neither is available).
  const storeToken = lock ? tokens.find((t) => t.symbol === lock.tokenSymbol) : undefined;
  const [closes, setCloses] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCloses([]);
    if (!lock?.tokenAddress) return;
    void fetchTokenMarketData(lock.chainId, lock.tokenAddress).then((d) => {
      if (cancelled || !d?.pairAddress) return;
      void fetchCandles(lock.chainId, d.pairAddress, 'day', 100).then((c: Candle[]) => {
        if (!cancelled) setCloses(c.map((x) => x.close));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [lock?.tokenAddress, lock?.chainId]);

  if (!lock) {
    return (
      <View style={styles.missing}>
        <Text style={styles.title}>Lock not found</Text>
        <Text style={styles.missingBody}>This lock is no longer in your vault.</Text>
        <Btn label="Back to Vault" onPress={() => router.replace('/(tabs)/vault')} />
      </View>
    );
  }

  // Price at lock time is the honest fallback when no live price exists.
  const currentPrice = storeToken?.price ?? lock.entryPrice;
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
    // Local state only: on-chain claim needs a deployed vault + signer
    // (see lib/vault.ts claimMaturedOnChain). The record is pending with
    // no tx hash — never marked confirmed for a claim never submitted.
    updateLock({ ...lock, status: 'completed', amountRemaining: 0 });
    addTx({
      id: `local-${Date.now()}`, hash: '', kind: 'unlock', token: lock.tokenSymbol,
      amount: lock.amountRemaining, amountRaw: String(lock.amountRemaining), usd: value,
      note: `Lock marked claimed locally — on-chain claim not submitted (vault not deployed on this chain yet)`,
      at: Date.now(), status: 'pending', isSpam: false, chainId: lock.chainId, blockNumber: null,
    });
    Alert.alert('Claimed (local record)', `${fmtNum(lock.amountRemaining)} ${lock.tokenSymbol} marked returned. On-chain claim is unavailable until the vault is deployed on this chain.`);
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
            addTx({ id: `local-${Date.now()}`, hash: '', kind: 'unlock', token: lock.tokenSymbol, amount: 0, amountRaw: '0', usd: 0, note: `Break requested locally for ${lock.id} — 24h cooling-off started (no on-chain transaction submitted)`, at: Date.now(), status: 'pending', isSpam: false, chainId: lock.chainId, blockNumber: null });
            Alert.alert('Cooling-off started', 'You can complete the break after 24 hours. Use the time to reconsider.');
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>{lock.id}</Text>
      <Text style={styles.sub}>
        {fmtNum(lock.amountRemaining)} {lock.tokenSymbol} · {chain.name} · {lock.status.replace('-', ' ')}
      </Text>

      <Card dark style={styles.valueCard}>
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
                {trailingBreached ? 'Breached — remainder auto-sells.' : anyTargetHit ? 'Armed.' : 'Arms after the first target hit.'}
              </Text>
            )}
          </Card>
        </>
      )}

      <SectionTitle title="Locked position" />
      <PriceChart series={closes} height={140} />

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
        <Btn label="Share Receipt" variant="ghost" onPress={() => Alert.alert('Receipt', `${lock.id} · ${fmtNum(lock.amount)} ${lock.tokenSymbol} · ${chain.name}`)} style={styles.actionBtn} />
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  breach: { color: COLORS.red, fontWeight: '700' },
  countdown: { color: COLORS.mint, fontSize: 14, fontWeight: '800', marginTop: 6 },
  date: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 12 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  missing: { backgroundColor: COLORS.bg, flex: 1, gap: 12, justifyContent: 'center', padding: 16 },
  missingBody: { color: COLORS.textMuted, fontSize: 12 },
  progressLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sentence: { color: COLORS.text, fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 10 },
  stageRow: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 6 },
  stageText: { color: COLORS.text, flex: 1, fontSize: 12, fontWeight: '700' },
  stageUsd: { color: COLORS.textMuted, fontSize: 12 },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  targetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  targetText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  termLabel: { color: COLORS.textMuted, fontSize: 12 },
  termRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  termValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  value: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  valueCard: { marginTop: 12, padding: 14 },
});
