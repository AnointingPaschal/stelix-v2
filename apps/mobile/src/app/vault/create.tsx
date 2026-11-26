/** Screen 13 — Create Lock (4 steps): token+amount, date+target, exit plan, review+confirm. */
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { getChain, VAULT_DEFAULTS } from '../../lib/chains';
import { fmtNum, fmtPrice, fmtUsd } from '../../lib/format';
import {
  lockSummarySentence,
  minimumReceive,
  validateLadder,
  type BreakMode,
  type BullLock,
  type LadderStage,
} from '../../lib/vault';
import { Btn, Card, Chip, DemoBadge, RiskNote, SectionTitle } from '../../components/ui';

const DURATIONS = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
];
const TARGETS: { label: string; multiple: number | null }[] = [
  { label: 'None (date only)', multiple: null },
  { label: '2x', multiple: 2 },
  { label: '3x', multiple: 3 },
  { label: '5x', multiple: 5 },
  { label: '10x', multiple: 10 },
];

export default function CreateLock() {
  const { tokens, chain, addLock, addTx } = useApp();
  const [step, setStep] = useState(1);
  const [symbol, setSymbol] = useState('WKC');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState(365);
  const [target, setTarget] = useState<number | null>(3);
  const [customPrice, setCustomPrice] = useState('');
  const [ladderOn, setLadderOn] = useState(true);
  const [ladder, setLadder] = useState<LadderStage[]>([
    { multiple: 2, percent: 25, status: 'pending' },
    { multiple: 3, percent: 25, status: 'pending' },
    { multiple: 5, percent: 25, status: 'pending' },
    { multiple: 10, percent: 25, status: 'pending' },
  ]);
  const [trailing, setTrailing] = useState<number | null>(1500);
  const [autoSell, setAutoSell] = useState(true);
  const [breakMode, setBreakMode] = useState<BreakMode>('penalty');
  const [pin, setPin] = useState('');
  const [created, setCreated] = useState<BullLock | null>(null);

  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];
  const amt = parseFloat(amount) || 0;
  const entryPrice = token.price;
  const targetPrice = target === null ? null : customPrice ? parseFloat(customPrice) || null : entryPrice * target;
  const unlockTime = Date.now() + days * 86_400_000;
  const exitLabel = getChain(chain.id).exitStablecoinLabel;
  const ladderError = ladderOn ? validateLadder(ladder) : null;

  const preview: BullLock = useMemo(
    () => ({
      id: `LCK-${Date.now()}`,
      chainId: chain.id,
      tokenSymbol: token.symbol,
      tokenAddress: token.address,
      amount: amt,
      amountRemaining: amt,
      entryPrice,
      unlockTime,
      targetPrice,
      targetMultiple: target,
      ladder: ladderOn ? ladder : [],
      trailingStopBps: trailing,
      peakPrice: entryPrice,
      breakMode,
      penaltyBps: breakMode === 'penalty' ? 500 : 0,
      autoSell: targetPrice !== null ? autoSell : false,
      slippageBps: VAULT_DEFAULTS.slippageBps,
      minReceiveUsd: 100,
      status: 'active',
      createdAt: Date.now(),
    }),
    [amt, chain.id, token, entryPrice, unlockTime, targetPrice, target, ladderOn, ladder, trailing, breakMode, autoSell],
  );

  function next() {
    if (step === 1) {
      if (amt <= 0 || amt > token.balance) {
        Alert.alert('Check the amount', `Enter an amount up to your spendable ${fmtNum(token.balance)} ${token.symbol}. Locked funds cannot be locked twice.`);
        return;
      }
    }
    if (step === 3 && ladderError) {
      Alert.alert('Ladder does not add up', ladderError);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }

  function confirm() {
    if (pin.length !== 6) {
      Alert.alert('Discipline PIN required', 'Enter your 6-digit Discipline PIN to confirm this lock.');
      return;
    }
    const lock: BullLock = { ...preview, txHash: `0x${'demo'.padEnd(62, 'a')}` };
    addLock(lock);
    addTx({
      id: `tx-${Date.now()}`,
      kind: 'lock',
      token: token.symbol,
      amount: amt,
      usd: amt * entryPrice,
      note: `Locked ${fmtNum(amt)} ${token.symbol} until ${new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${target ? ` or ${target}x` : ''}`,
      at: Date.now(),
      status: 'confirmed',
    });
    setCreated(lock);
  }

  if (created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <Card style={styles.done}>
          <Text style={styles.doneTitle}>Lock created (DEMO)</Text>
          <Text style={styles.doneBody}>Lock ID {created.id}</Text>
          <Text style={styles.doneBody}>Receipt: {fmtNum(created.amount)} {created.tokenSymbol} · {fmtUsd(created.amount * created.entryPrice)}</Text>
          <Text style={styles.doneBody}>Unlock: {new Date(created.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          <Text style={styles.doneBody}>Reminders on: 7 days, 1 day and 1 hour before maturity; at 50% / 80% / 100% of target.</Text>
        </Card>
        <Btn label="View Lock" onPress={() => router.replace(`/vault/${created.id}`)} />
        <Btn label="Back to Vault" variant="ghost" onPress={() => router.replace('/(tabs)/vault')} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Create Lock</Text>
        <DemoBadge />
      </View>
      <Text style={styles.steps}>Step {step} of 4 · {['Token & amount', 'Date & target', 'Exit plan', 'Review & confirm'][step - 1]}</Text>
      <View style={styles.progress}>
        {[1, 2, 3, 4].map((s) => (
          <View key={s} style={[styles.dot, s <= step && styles.dotOn]} />
        ))}
      </View>

      {step === 1 && (
        <>
          <SectionTitle title="Token" />
          <View style={styles.pills}>
            {tokens.filter((t) => !t.isSpam).map((t) => (
              <Btn key={t.symbol} label={t.symbol} variant={symbol === t.symbol ? 'primary' : 'ghost'} onPress={() => setSymbol(t.symbol)} style={styles.pill} />
            ))}
          </View>
          <SectionTitle title="Amount to lock" />
          <TextInput style={styles.amountInput} keyboardType="decimal-pad" placeholder="0.0" value={amount} onChangeText={setAmount} />
          <View style={styles.pctRow}>
            {[25, 50, 75, 100].map((p) => (
              <Btn key={p} label={`${p}%`} variant="ghost" onPress={() => setAmount(String((token.balance * p) / 100))} style={styles.pctBtn} />
            ))}
          </View>
          <Text style={styles.hint}>
            Spendable: {fmtNum(token.balance)} {token.symbol} ({fmtUsd(token.balance * token.price)}) · after lock:{' '}
            {fmtUsd(Math.max(0, token.balance - amt) * token.price)}
          </Text>
        </>
      )}

      {step === 2 && (
        <>
          <SectionTitle title="Duration" />
          <View style={styles.pills}>
            {DURATIONS.map((d) => (
              <Btn key={d.label} label={d.label} variant={days === d.days ? 'primary' : 'ghost'} onPress={() => setDays(d.days)} style={styles.pill} />
            ))}
          </View>
          <Text style={styles.hint}>Unlocks {new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</Text>
          <SectionTitle title="Price target" />
          <View style={styles.pills}>
            {TARGETS.map((t) => (
              <Btn key={t.label} label={t.label} variant={target === t.multiple ? 'primary' : 'ghost'} onPress={() => setTarget(t.multiple)} style={styles.pill} />
            ))}
          </View>
          {target !== null && (
            <>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder={`Custom target price (default ${fmtPrice(entryPrice * target)})`}
                value={customPrice}
                onChangeText={setCustomPrice}
              />
              <Card style={styles.targetCard}>
                <Text style={styles.targetText}>Entry {fmtPrice(entryPrice)}</Text>
                <Text style={styles.targetText}>Target {targetPrice ? fmtPrice(targetPrice) : '—'}</Text>
                <Text style={styles.targetText}>
                  Est. value at target: {fmtUsd(amt * (targetPrice ?? entryPrice))}
                </Text>
              </Card>
            </>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <SectionTitle title="On target hit" />
          <View style={styles.pills}>
            <Btn label={`${exitLabel} (auto-sell)`} variant={autoSell ? 'mint' : 'ghost'} onPress={() => setAutoSell(true)} style={styles.wideBtn} />
            <Btn label="Unlock to wallet (manual)" variant={!autoSell ? 'primary' : 'ghost'} onPress={() => setAutoSell(false)} style={styles.wideBtn} />
          </View>
          <SectionTitle title="Profit ladder" />
          <View style={styles.pills}>
            <Btn label="Ladder on" variant={ladderOn ? 'mint' : 'ghost'} onPress={() => setLadderOn(true)} style={styles.pill} />
            <Btn label="Ladder off (sell all at target)" variant={!ladderOn ? 'primary' : 'ghost'} onPress={() => setLadderOn(false)} style={styles.pill} />
          </View>
          {ladderOn && (
            <Card>
              {ladder.map((s, i) => (
                <View key={s.multiple} style={styles.ladderRow}>
                  <Text style={styles.ladderLabel}>{s.multiple}x</Text>
                  <TextInput
                    style={styles.ladderInput}
                    keyboardType="number-pad"
                    value={String(s.percent)}
                    onChangeText={(v) => {
                      const next = [...ladder];
                      next[i] = { ...s, percent: parseInt(v, 10) || 0 };
                      setLadder(next);
                    }}
                  />
                  <Text style={styles.ladderPct}>%</Text>
                </View>
              ))}
              {ladderError && <Text style={styles.error}>{ladderError}</Text>}
            </Card>
          )}
          <SectionTitle title="Trailing stop" />
          <View style={styles.pills}>
            {[
              { label: 'Off', v: null },
              { label: '10%', v: 1000 },
              { label: '15%', v: 1500 },
              { label: '20%', v: 2000 },
            ].map((o) => (
              <Btn key={o.label} label={o.label} variant={trailing === o.v ? 'primary' : 'ghost'} onPress={() => setTrailing(o.v)} style={styles.pill} />
            ))}
          </View>
          <Text style={styles.hint}>
            After any target is hit, a fall of the chosen % from the peak auto-sells the remainder {exitLabel}. Slippage
            default 1.5% · minimum receive shown at review.
          </Text>
          <SectionTitle title="Break mode" />
          <View style={styles.pills}>
            <Btn label="Immutable (strongest)" variant={breakMode === 'immutable' ? 'primary' : 'ghost'} onPress={() => setBreakMode('immutable')} style={styles.wideBtn} />
            <Btn label="Penalty break (5%, 24h cooling-off)" variant={breakMode === 'penalty' ? 'primary' : 'ghost'} onPress={() => setBreakMode('penalty')} style={styles.wideBtn} />
            <Btn label="Guardian break (Phase 2)" variant={breakMode === 'guardian' ? 'primary' : 'ghost'} onPress={() => setBreakMode('guardian')} style={styles.wideBtn} />
          </View>
          <Text style={styles.hint}>No penalty is ever charged when a price target or the maturity date triggers the exit.</Text>
        </>
      )}

      {step === 4 && (
        <>
          <Card dark>
            <Text style={styles.reviewTitle}>Review your lock</Text>
            <ReviewRow label="Token" value={`${fmtNum(amt)} ${token.symbol} (${fmtUsd(amt * entryPrice)})`} />
            <ReviewRow label="Chain" value={`${chain.name}${chain.testnet ? ' (testnet)' : ''}`} />
            <ReviewRow label="Vault contract" value="Not deployed yet — admin Contract Studio (testnet first)" />
            <ReviewRow label="Unlock date" value={new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <ReviewRow label="Target" value={targetPrice ? `${target}x · ${fmtPrice(targetPrice)}` : 'None — date lock'} />
            <ReviewRow label="Exit" value={targetPrice ? (autoSell ? exitLabel : 'Unlock to wallet') : 'Unlock to wallet'} />
            <ReviewRow label="Ladder" value={ladderOn ? ladder.map((s) => `${s.percent}% @ ${s.multiple}x`).join(' · ') : 'Off'} />
            <ReviewRow label="Trailing stop" value={trailing ? `${trailing / 100}%` : 'Off'} />
            <ReviewRow label="Break mode" value={breakMode === 'immutable' ? 'Immutable — no early break' : breakMode === 'penalty' ? 'Penalty break — 5% after 24h cooling-off' : 'Guardian break — approval + 48h delay'} />
            <ReviewRow label="Slippage" value="1.5% (default)" />
            <ReviewRow label="Minimum receive" value={targetPrice ? fmtUsd(minimumReceive(amt * (targetPrice ?? entryPrice), VAULT_DEFAULTS.slippageBps)) : '—'} />
            <ReviewRow label="Stelix fee" value="0% in this demo (set in admin before mainnet)" />
            <ReviewRow label="Network fee (est.)" value="≈ $0.42" />
          </Card>
          <Text style={styles.sentence}>{lockSummarySentence(preview, exitLabel)}</Text>
          <Text style={styles.label}>Discipline PIN (6 digits)</Text>
          <TextInput style={styles.input} keyboardType="number-pad" maxLength={6} secureTextEntry placeholder="••••••" value={pin} onChangeText={setPin} />
          <Text style={styles.hint}>Confirm with your Discipline PIN + biometrics. Then approve the token spend and sign the lock transaction.</Text>
        </>
      )}

      <View style={styles.nav}>
        {step > 1 && <Btn label="Back" variant="ghost" onPress={() => setStep((s) => s - 1)} style={styles.navBtn} />}
        {step < 4 ? (
          <Btn label="Continue" onPress={next} style={styles.navBtn} />
        ) : (
          <Btn label="Confirm Lock" variant="mint" onPress={confirm} style={styles.navBtn} />
        )}
      </View>
      <RiskNote />
    </ScrollView>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amountInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 26, fontWeight: '800', padding: 14 },
  done: { backgroundColor: COLORS.mintSoft },
  doneBody: { color: COLORS.mintDark, fontSize: 14, lineHeight: 21, marginTop: 4 },
  doneTitle: { color: COLORS.mintDark, fontSize: 18, fontWeight: '800' },
  dot: { backgroundColor: COLORS.border, borderRadius: 999, flex: 1, height: 6 },
  dotOn: { backgroundColor: COLORS.mint },
  error: { color: COLORS.red, fontSize: 13, marginTop: 8 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hint: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  inner: { padding: 20 },
  input: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 15, marginTop: 10, padding: 14 },
  label: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 16 },
  ladderInput: { backgroundColor: COLORS.bgMuted, borderRadius: 8, fontSize: 15, padding: 8, textAlign: 'center', width: 64 },
  ladderLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700', width: 48 },
  ladderPct: { color: COLORS.textMuted, fontSize: 15 },
  ladderRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 6 },
  nav: { flexDirection: 'row', gap: 10, marginTop: 20 },
  navBtn: { flex: 1 },
  pctBtn: { flex: 1, minHeight: 40 },
  pctRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pill: { minHeight: 40, paddingHorizontal: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 12 },
  reviewLabel: { color: COLORS.textOnNavyMuted, fontSize: 13 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  reviewTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  reviewValue: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sentence: { color: COLORS.text, fontSize: 15, fontWeight: '700', lineHeight: 22, marginTop: 16 },
  steps: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 6 },
  targetCard: { marginTop: 12 },
  targetText: { color: COLORS.text, fontSize: 14, fontWeight: '700', paddingVertical: 2 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  wideBtn: { minHeight: 44, paddingHorizontal: 12 },
});
