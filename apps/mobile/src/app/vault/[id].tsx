/** Screen 14 — Lock Detail: countdown, target progress, ladder checklist,
 *  claim / break. Compact v1 sizes. Claim and break are REAL on-chain
 *  calls (see lib/vault.ts) for on-chain locks — the hash is shown and
 *  recorded only after mining. executeTrigger is keeper-only and is not
 *  exposed here (see lib/vault.ts executeTriggerOnChain). Signing happens
 *  ONLY in the shared SignTransactionModal — there is no password field
 *  on this page. */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fetchCandles, fetchTokenMarketData, type Candle } from '../../lib/prices';
import { fmtDateTime, fmtNum, fmtPrice, fmtUsd, timeLeft } from '../../lib/format';
import { getChain, getVaultDeploymentStatus } from '../../lib/chains';
import { getSignerForChain } from '../../lib/signer';
import {
  breakPenaltyTokens,
  claimMaturedOnChain,
  claimTriggeredStageOnChain,
  executeBreakOnChain,
  isTrailingStopBreached,
  lockSummarySentence,
  parseOnChainLockId,
  requestBreakOnChain,
  targetProgress,
} from '../../lib/vault';
import { Btn, Card, Chip, ProgressBar, RiskNote, SectionTitle, centeredContent } from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../../components/SignTransactionModal';

interface PendingVaultSign {
  request: SignTxRequest;
  run: (signer: Awaited<ReturnType<typeof getSignerForChain>>) => Promise<string>;
  onDone: (hash: string) => void;
}

export default function LockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locks, tokens, address, settings, updateLock, addTx, refreshLocks } = useApp();
  const insets = useSafeAreaInsets();

  const lock = locks.find((l) => l.id === id);
  const [notice, setNotice] = useState('');
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const [signModal, setSignModal] = useState<PendingVaultSign | null>(null);
  const onChain = lock ? parseOnChainLockId(lock.id) : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000); // live countdown
    return () => clearInterval(t);
  }, []);

  // Live price + real candles for the locked token (store price first,
  // DexScreener market data as fallback; "—" when neither is available).
  const storeToken = lock ? tokens.find((t) => t.symbol === lock.tokenSymbol) : undefined;
  const [lockCandles, setLockCandles] = useState<Candle[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLockCandles([]);
    if (!lock?.tokenAddress) return;
    void fetchTokenMarketData(lock.chainId, lock.tokenAddress).then((d) => {
      if (cancelled || !d?.pairAddress) return;
      void fetchCandles(lock.chainId, d.pairAddress, 'day', 100).then((c: Candle[]) => {
        if (!cancelled) setLockCandles(c);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [lock?.tokenAddress, lock?.chainId]);

  if (!lock) {
    return (
      <View style={[styles.missing, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
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

  /** Open the shared signing modal for one vault action. Nothing is
   *  signed here — the modal collects the session password (or
   *  biometrics) and calls signVaultTx below. */
  function openSign(
    label: string,
    actionLabel: string,
    rows: { label: string; value: string; danger?: boolean }[],
    warning: string | null,
    run: PendingVaultSign['run'],
    onDone: (hash: string) => void,
  ) {
    if (!lock) return;
    const vault = getVaultDeploymentStatus(lock.chainId);
    setNotice('');
    setSignModal({
      request: {
        title: `Confirm ${label}`,
        actionLabel,
        fromAddress: address,
        toAddress: vault.deployed ? vault.address : 'Vault not deployed on this chain',
        toLabel: 'StelixVault contract',
        network: `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
        rows,
        warning,
        explorerBase: chain.explorerUrl,
      },
      run,
      onDone,
    });
  }

  async function signVaultTx(password: string): Promise<SignTxResult> {
    if (!lock || !signModal) throw new Error('No vault action to sign.');
    const signer = await getSignerForChain(password, lock.chainId);
    const hash = await signModal.run(signer);
    return { hash, blockNumber: null };
  }

  async function onVaultSigned(res: SignTxResult) {
    if (!signModal) return;
    setLastTx(res.hash);
    await refreshLocks();
    signModal.onDone(res.hash);
  }

  function claim() {
    if (!lock || !onChain) {
      setNotice('This lock has no on-chain record, so there is nothing to claim on-chain.');
      return;
    }
    openSign(
      'Claim',
      'Sign & Claim',
      [
        { label: 'You claim', value: `${fmtNum(lock.amountRemaining)} ${lock.tokenSymbol}` },
        { label: 'Value', value: fmtUsd(value) },
        { label: 'Lock', value: lock.id },
      ],
      null,
      (signer) => claimMaturedOnChain(signer, lock.chainId, onChain.lockId),
      (hash) => {
        updateLock({ ...lock, status: 'completed', amountRemaining: 0 });
        addTx({
          id: hash, hash, kind: 'unlock', token: lock.tokenSymbol,
          amount: lock.amountRemaining, amountRaw: String(lock.amountRemaining), usd: value,
          note: `Matured lock claimed on-chain`,
          at: Date.now(), status: 'confirmed', isSpam: false, chainId: lock.chainId, blockNumber: null,
        });
      },
    );
  }

  /** First ladder stage whose target the live price has reached. The
   *  contract re-checks the 30-minute TWAP on-chain and reverts if the
   *  target is not actually met — the price here only decides whether
   *  the button is shown. */
  const dueStageIndex = lock
    ? lock.ladder.findIndex((s) => s.status === 'pending' && currentPrice >= lock.entryPrice * s.multiple)
    : -1;

  async function claimStage() {
    if (!lock || !onChain || dueStageIndex < 0) return;
    const stage = lock.ladder[dueStageIndex];
    const soldAmount = (lock.amount * stage.percent) / 100;
    openSign(
      'Claim Stage',
      'Sign & Claim Stage',
      [
        { label: 'You claim', value: `${fmtNum(soldAmount)} ${lock.tokenSymbol} (${stage.percent}% at ${stage.multiple}x)` },
        { label: 'Value', value: fmtUsd(soldAmount * currentPrice) },
        { label: 'Lock', value: lock.id },
      ],
      null,
      (signer) => claimTriggeredStageOnChain(signer, lock.chainId, onChain.lockId, dueStageIndex),
      (hash) => {
        const nextLadder = lock.ladder.map((s, i) => (i === dueStageIndex ? { ...s, status: 'sold' as const } : s));
        updateLock({
          ...lock,
          ladder: nextLadder,
          amountRemaining: Math.max(0, lock.amountRemaining - soldAmount),
          status: lock.amountRemaining - soldAmount <= 0 ? 'completed' : 'partially-sold',
        });
        addTx({
          id: hash, hash, kind: 'autosell', token: lock.tokenSymbol,
          amount: soldAmount, amountRaw: String(soldAmount), usd: soldAmount * currentPrice,
          note: `Ladder stage claimed on-chain: ${stage.percent}% at ${stage.multiple}x`,
          at: Date.now(), status: 'confirmed', isSpam: false, chainId: lock.chainId, blockNumber: null,
        });
      },
    );
  }

  const coolingOffMs = lock?.breakMode === 'guardian' ? 48 * 3_600_000 : 24 * 3_600_000;
  const breakReady =
    lock?.breakRequestedAt !== undefined && Date.now() >= lock.breakRequestedAt + coolingOffMs;

  async function executeBreak() {
    if (!lock || !onChain) return;
    openSign(
      'Execute Break',
      'Sign & Execute Break',
      [
        { label: 'You receive', value: `${fmtNum(Math.max(0, lock.amountRemaining - penalty))} ${lock.tokenSymbol}` },
        { label: 'Penalty', value: penalty > 0 ? `${fmtNum(penalty)} ${lock.tokenSymbol} (${lock.penaltyBps / 100}%)` : 'None' },
        { label: 'Lock', value: lock.id },
      ],
      'Completing the break returns the remaining funds (minus any penalty) to your wallet.',
      (signer) => executeBreakOnChain(signer, lock.chainId, onChain.lockId),
      (hash) => {
        updateLock({ ...lock, status: 'broken', amountRemaining: 0 });
        addTx({
          id: hash, hash, kind: 'unlock', token: lock.tokenSymbol,
          amount: lock.amountRemaining, amountRaw: String(lock.amountRemaining), usd: value,
          note: `Lock broken on-chain after cooling-off${penalty > 0 ? ` (penalty ${fmtNum(penalty)} ${lock.tokenSymbol})` : ''}`,
          at: Date.now(), status: 'confirmed', isSpam: false, chainId: lock.chainId, blockNumber: null,
        });
      },
    );
  }

  function requestBreak() {
    if (!lock) return;
    if (lock.breakMode === 'immutable') {
      setNotice('Immutable lock — this lock cannot be broken early. It unlocks on its date or its price target.');
      return;
    }
    if (!onChain) {
      setNotice('This lock has no on-chain record, so no break can be requested on-chain.');
      return;
    }
    openSign(
      'Request Break',
      'Sign & Start Cooling-off',
      [
        { label: 'Locked', value: `${fmtNum(lock.amountRemaining)} ${lock.tokenSymbol}` },
        { label: 'Penalty', value: penalty > 0 ? `${fmtNum(penalty)} ${lock.tokenSymbol} (${lock.penaltyBps / 100}%)` : 'None' },
        { label: 'Cooling-off', value: lock.breakMode === 'guardian' ? '48 hours' : '24 hours' },
      ],
      penalty > 0
        ? `Early break costs ${fmtNum(penalty)} ${lock.tokenSymbol} (${lock.penaltyBps / 100}% penalty) after a ${lock.breakMode === 'guardian' ? '48' : '24'}-hour cooling-off period. The penalty is waived only when a target or the date triggers the exit.`
        : 'This break has no token penalty, but it still needs the cooling-off period.',
      (signer) => requestBreakOnChain(signer, lock.chainId, onChain.lockId),
      (hash) => {
        updateLock({ ...lock, breakRequestedAt: Date.now() });
        addTx({ id: hash, hash, kind: 'unlock', token: lock.tokenSymbol, amount: 0, amountRaw: '0', usd: 0, note: `Break requested on-chain for ${lock.id} — cooling-off started`, at: Date.now(), status: 'confirmed', isSpam: false, chainId: lock.chainId, blockNumber: null });
      },
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
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
      <PriceChart
        candles={lockCandles}
        chartType="line"
        showEma7={false}
        showEma25={false}
        showVolume={false}
        showMacd={false}
        seriesKey={`${lock.chainId}:${lock.tokenAddress}:lock`}
        height={140}
      />

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
        <Term label="Contract" value={(() => { const s = getVaultDeploymentStatus(lock.chainId); return s.deployed ? s.address : 'Not deployed yet (testnet first)'; })()} />
        <Term label="Tx hash" value={lock.txHash ? `${lock.txHash.slice(0, 12)}…${lock.txHash.slice(-6)}` : '—'} />
        <Text style={styles.sentence}>{lockSummarySentence(lock, chain.exitStablecoinLabel)}</Text>
      </Card>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {lastTx ? (
        <Text style={styles.sentLine}>Last tx {lastTx.slice(0, 12)}…{lastTx.slice(-6)} — recorded in History.</Text>
      ) : null}
      {!onChain ? (
        <Text style={styles.hint}>This lock has no on-chain record, so claim and break are unavailable.</Text>
      ) : null}

      <View style={styles.actions}>
        {matured && lock.status !== 'completed' && (
          <Btn label="Claim" variant="mint" onPress={() => void claim()} disabled={!onChain} style={styles.actionBtn} />
        )}
        {dueStageIndex >= 0 && lock.status !== 'completed' && (
          <Btn label={`Claim ${lock.ladder[dueStageIndex].multiple}x stage`} variant="mint" onPress={() => void claimStage()} disabled={!onChain} style={styles.actionBtn} />
        )}
        {breakReady && lock.status !== 'completed' && lock.status !== 'broken' ? (
          <Btn label="Execute Break" variant="danger" onPress={() => void executeBreak()} disabled={!onChain} style={styles.actionBtn} />
        ) : lock.status === 'completed' ? (
          <Chip label="Completed" tone="mint" />
        ) : (
          <Btn
            label={penaltyError ? 'Break Lock (not allowed)' : lock.breakRequestedAt !== undefined ? 'Cooling-off running…' : 'Break Lock'}
            variant="danger"
            onPress={requestBreak}
            disabled={!!penaltyError || !onChain || lock.breakRequestedAt !== undefined}
            style={styles.actionBtn}
          />
        )}
        <Btn
          label={copiedReceipt ? 'Receipt Copied' : 'Share Receipt'}
          variant="ghost"
          onPress={() => {
            // Copies the receipt text — the old Alert.alert was a no-op
            // on web, so the button looked dead.
            void Clipboard.setStringAsync(
              `Stelix lock ${lock.id} · ${fmtNum(lock.amount)} ${lock.tokenSymbol} · ${chain.name} · unlocks ${new Date(lock.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${lock.txHash ? ` · tx ${lock.txHash}` : ''}`,
            ).then(() => {
              setCopiedReceipt(true);
              setTimeout(() => setCopiedReceipt(false), 2000);
            });
          }}
          style={styles.actionBtn}
        />
      </View>
      {copiedReceipt ? <Text style={styles.sentLine}>Receipt copied — paste it anywhere to share.</Text> : null}
      <RiskNote />

      <SignTransactionModal
        visible={signModal !== null}
        request={signModal?.request ?? null}
        biometricsEnabled={settings.biometrics}
        onClose={() => setSignModal(null)}
        onSign={signVaultTx}
        onSigned={(res) => void onVaultSigned(res)}
      />
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
  actionBtn: { flexBasis: 140, flexGrow: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  breach: { color: COLORS.red, fontWeight: '700' },
  countdown: { color: COLORS.mint, fontSize: 14, fontWeight: '800', marginTop: 6 },
  date: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 12 },
  label: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  missing: { backgroundColor: COLORS.bg, flex: 1, gap: 12, justifyContent: 'center', padding: 16 },
  missingBody: { color: COLORS.textMuted, fontSize: 12 },
  notice: { color: COLORS.red, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  sentLine: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  progressLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sentence: { color: COLORS.text, fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 10 },
  stageRow: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 6 },
  stageText: { color: COLORS.text, flex: 1, fontSize: 12, fontWeight: '700' },
  stageUsd: { color: COLORS.textMuted, fontSize: 12 },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 8 },
  targetText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  termLabel: { color: COLORS.textMuted, flexShrink: 0, fontSize: 12 },
  termRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  termValue: { color: COLORS.text, flexShrink: 1, fontSize: 12, fontWeight: '700', marginLeft: 12, textAlign: 'right' },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  value: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  valueCard: { marginTop: 12, padding: 14 },
});
