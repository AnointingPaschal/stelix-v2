/** Screen 13 — Create Lock (4 steps): token+amount, date+target, exit plan,
 *  review+confirm. Compact v1 sizes. Accepts prefill params from the token
 *  detail's Create Discipline card (symbol, amount, days, target,
 *  customPrice, ladder, trailing, breakMode). No invented fees — the Stelix
 *  fee, slippage, min/max lock and penalty defaults come from the admin's
 *  published fee config via the live admin sync (store/AppContext.tsx);
 *  when the admin has never published fees the wallet uses its local
 *  defaults and SAYS so. The network fee is shown by the wallet
 *  before signing. Signing happens ONLY in the shared
 *  SignTransactionModal — there is no session-password field on this page,
 *  and no "Discipline PIN" either: the old 6-digit PIN accepted ANY six
 *  digits (it was never set or verified anywhere), so it was security
 *  theatre, not a check. The signing modal's session password is the
 *  real confirmation. */
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { getChain, VAULT_NOT_DEPLOYED_MESSAGE } from '../../lib/chains';
import { fmtNum, fmtPrice, fmtUsd } from '../../lib/format';
import { getSignerForChain } from '../../lib/signer';
import {
  createLockOnChain,
  lockSummarySentence,
  minReceivePerStageUsd,
  validateLadder,
  type BreakMode,
  type BullLock,
  type LadderStage,
} from '../../lib/vault';
import { Btn, Card, RiskNote, SectionTitle, centeredContent } from '../../components/ui';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../../components/SignTransactionModal';

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
  const params = useLocalSearchParams<{
    symbol?: string;
    amount?: string;
    days?: string;
    target?: string;
    customPrice?: string;
    ladder?: string;
    trailing?: string;
    breakMode?: string;
  }>();
  const { tokens, chain, address, settings, addLock, addTx, refreshLocks, adminFees, appConfig } = useApp();
  const insets = useSafeAreaInsets();
  // Live admin fees (source 'admin' when the admin has published fees,
  // 'default' with an honest label when not) and feature flags.
  const fees = adminFees.fees;
  const slippageBps = Math.round(fees.defaultSlippagePct * 100);
  const feeLabel =
    adminFees.source === 'admin'
      ? `${fees.autoSellFeePct}% (set by admin${adminFees.version !== null ? ` v${adminFees.version}` : ''})`
      : `${fees.autoSellFeePct}% — no admin fee published yet (app default)`;
  const autoSellAllowed = appConfig?.flags.bullLockAutoSell !== false;
  const trailingAllowed = appConfig?.flags.trailingStop !== false;
  // Trailing-stop options offered by the admin, e.g. 'Off, 10%, 15%, 20%'.
  const trailingOptions = useMemo(() => {
    const parsed = fees.trailingStopOptions
      .split(',')
      .map((s) => s.trim())
      .map((s) => {
        if (/^off$/i.test(s)) return { label: 'Off', v: null as number | null };
        const m = /^(\d+(?:\.\d+)?)%$/.exec(s);
        return m ? { label: s, v: Math.round(parseFloat(m[1]) * 100) } : null;
      })
      .filter((o): o is { label: string; v: number | null } => o !== null);
    return parsed.length > 0 ? parsed : [
      { label: 'Off', v: null as number | null },
      { label: '10%', v: 1000 },
      { label: '15%', v: 1500 },
      { label: '20%', v: 2000 },
    ];
  }, [fees.trailingStopOptions]);

  const [step, setStep] = useState(1);
  const [symbol, setSymbol] = useState(params.symbol ?? tokens[0]?.symbol ?? '');
  const [amount, setAmount] = useState(params.amount ?? '');
  const [days, setDays] = useState(params.days ? parseInt(params.days, 10) : 365);
  // An explicit empty `target` param means "date only" (Token Detail's
  // Date mode passes target=''). The old code treated '' as falsy and
  // defaulted to 3x — a date-only prefill silently became a 3x lock.
  const [target, setTarget] = useState<number | null>(
    params.target === '' ? null : params.target ? parseInt(params.target, 10) : 3,
  );
  const [customPrice, setCustomPrice] = useState(params.customPrice ?? '');
  const [ladderOn, setLadderOn] = useState(params.ladder !== '0');
  const [ladder, setLadder] = useState<LadderStage[]>([
    { multiple: 2, percent: 25, status: 'pending' },
    { multiple: 3, percent: 25, status: 'pending' },
    { multiple: 5, percent: 25, status: 'pending' },
    { multiple: 10, percent: 25, status: 'pending' },
  ]);
  const [trailing, setTrailing] = useState<number | null>(params.trailing ? parseInt(params.trailing, 10) : 1500);
  const [autoSell, setAutoSell] = useState(true);
  const [breakMode, setBreakMode] = useState<BreakMode>(
    params.breakMode === 'immutable' || params.breakMode === 'penalty' || params.breakMode === 'guardian'
      ? params.breakMode
      : 'penalty',
  );
  const [created, setCreated] = useState<BullLock | null>(null);
  const [formError, setFormError] = useState('');
  const [signModal, setSignModal] = useState<SignTxRequest | null>(null);
  // Vault deployment comes from the MERGED admin registry (chain.vaultContract),
  // not the built-in registry: a vault registered in Contract Studio shows
  // as deployed here on the next admin sync, with no app rebuild.
  const vaultStatus = chain.vaultContract
    ? { deployed: true as const, address: chain.vaultContract, message: '' }
    : { deployed: false as const, address: null as string | null, message: VAULT_NOT_DEPLOYED_MESSAGE };

  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];
  const amt = parseFloat(amount) || 0;
  const entryPrice = token?.price ?? 0;
  const spendable = token ? Math.max(0, token.balance - token.locked) : 0;
  const targetPrice = target === null ? null : customPrice ? parseFloat(customPrice) || null : entryPrice * target;
  const unlockTime = Date.now() + days * 86_400_000;
  const exitLabel = getChain(chain.id).exitStablecoinLabel;
  const ladderError = ladderOn ? validateLadder(ladder) : null;
  // A malformed custom price used to parse to NaN, then `|| null`
  // silently dropped the target — the lock became date-only with no
  // warning. Validate it instead.
  const customPriceError =
    target !== null && customPrice.trim() !== '' && !(parseFloat(customPrice) > 0)
      ? 'Enter a valid custom target price (a number above 0).'
      : null;
  // Minimum receive per stage, from the real stage value (see
  // lib/vault.ts minReceivePerStageUsd) — never the old hardcoded $100.
  const minReceiveUsd = minReceivePerStageUsd({
    amount: amt,
    entryPrice,
    targetPrice,
    ladder,
    ladderOn,
    slippageBps,
  });

  const preview: BullLock = useMemo(
    () => ({
      id: `LCK-${Date.now()}`,
      chainId: chain.id,
      tokenSymbol: token?.symbol ?? symbol,
      tokenAddress: token?.address ?? '',
      amount: amt,
      amountRemaining: amt,
      entryPrice,
      unlockTime,
      targetPrice,
      targetMultiple: target,
      ladder: ladderOn ? ladder : [],
      trailingStopBps: trailingAllowed ? trailing : null,
      peakPrice: entryPrice,
      breakMode,
      penaltyBps: breakMode === 'penalty' ? Math.round(fees.defaultPenaltyPct * 100) : 0,
      autoSell: targetPrice !== null ? autoSellAllowed && autoSell : false,
      slippageBps,
      minReceiveUsd,
      status: 'active',
      createdAt: Date.now(),
    }),
    [amt, chain.id, token, symbol, entryPrice, unlockTime, targetPrice, target, ladderOn, ladder, trailing, trailingAllowed, breakMode, autoSell, autoSellAllowed, fees.defaultPenaltyPct, slippageBps, minReceiveUsd],
  );

  function next() {
    setFormError('');
    if (step === 1) {
      if (!token || amt <= 0 || amt > spendable) {
        setFormError(`Check the amount — enter an amount up to your spendable ${fmtNum(spendable)} ${token?.symbol ?? ''}. Locked funds cannot be locked twice.`);
        return;
      }
      // Admin lock limits (live fee config): the USD value of the lock
      // must sit inside the admin's min / max. The source is named so a
      // limit change in admin is explainable here.
      const usdValue = amt * entryPrice;
      if (entryPrice > 0 && usdValue < fees.minLockUsd) {
        setFormError(`This lock would be ${fmtUsd(usdValue)} — below the minimum lock of ${fmtUsd(fees.minLockUsd)}${adminFees.source === 'admin' ? ' set by the admin' : ' (no admin fee published yet — app default)'}.`);
        return;
      }
      if (entryPrice > 0 && usdValue > fees.maxLockUsd) {
        setFormError(`This lock would be ${fmtUsd(usdValue)} — above the maximum lock of ${fmtUsd(fees.maxLockUsd)}${adminFees.source === 'admin' ? ' set by the admin' : ' (no admin fee published yet — app default)'}.`);
        return;
      }
    }
    if (step === 2 && customPriceError) {
      setFormError(customPriceError);
      return;
    }
    if (step === 3 && ladderError) {
      setFormError(ladderError);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }

  /** Step 4 Confirm: validates everything, then opens the signing modal.
   *  Nothing is signed here — the modal collects the session password
   *  (or biometrics) and calls signLock below. */
  async function confirm() {
    setFormError('');
    if (customPriceError) {
      setFormError(customPriceError);
      return;
    }
    if (targetPrice !== null && entryPrice > 0 && targetPrice <= entryPrice) {
      setFormError('Target price must be above the entry price — otherwise the target is already met.');
      return;
    }
    if (chain.kind !== 'evm') {
      setFormError('The vault is not available on Solana — the Solana vault is an Anchor program and is not wired yet. Locks are EVM-only for now; no lock was created.');
      return;
    }
    if (!vaultStatus.deployed) {
      setFormError(`${vaultStatus.message} (${chain.name}). No on-chain lock can be created yet, and no local-only lock is recorded — a lock that was never submitted is not a lock.`);
      return;
    }
    if (!token || !token.address) {
      setFormError('The native asset cannot be locked — the vault locks ERC-20 tokens. Lock an imported token instead of the native asset.');
      return;
    }
    if (token.price === null || entryPrice <= 0) {
      setFormError('This token has no live price, so no entry price can be recorded on-chain. Try again when a price is available.');
      return;
    }
    const stablecoin = getChain(chain.id).exitStablecoinAddress;
    if (!stablecoin) {
      setFormError(`No exit stablecoin address is registered for ${chain.name}. The lock cannot be created yet.`);
      return;
    }
    setSignModal({
      title: 'Confirm Lock',
      actionLabel: 'Sign & Create Lock',
      fromAddress: address,
      toAddress: vaultStatus.address,
      toLabel: 'StelixVault contract',
      network: `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
      rows: [
        { label: 'You lock', value: `${fmtNum(amt)} ${token.symbol} (${fmtUsd(amt * entryPrice)})` },
        { label: 'Unlock date', value: new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
        { label: 'Target', value: targetPrice ? `${target}x · ${fmtPrice(targetPrice)}` : 'None — date lock' },
        { label: 'Exit', value: targetPrice ? (autoSell ? exitLabel : 'Unlock to wallet') : 'Unlock to wallet' },
        { label: 'Ladder', value: ladderOn ? ladder.map((s) => `${s.percent}% @ ${s.multiple}x`).join(' · ') : 'Off' },
        { label: 'Trailing stop', value: trailing ? `${trailing / 100}%` : 'Off' },
        { label: 'Break mode', value: breakMode === 'immutable' ? 'Immutable — no early break' : breakMode === 'penalty' ? `Penalty break — ${fees.defaultPenaltyPct}% after 24h cooling-off` : 'Guardian break — approval + 48h delay' },
        { label: 'Slippage', value: `${fees.defaultSlippagePct}%${adminFees.source === 'admin' ? ' (set by admin)' : ' (app default — no admin fee published yet)'}` },
        { label: 'Stelix fee', value: feeLabel },
        { label: 'Network fee', value: 'Estimated at signing' },
      ],
      warning: 'You approve the token spend, then the lock is created on-chain. The vault must be deployed on this chain — otherwise no lock is created.',
      explorerBase: chain.explorerUrl,
    });
  }

  async function signLock(password: string): Promise<SignTxResult> {
    if (!token || !token.address) throw new Error('No token to lock.');
    const stablecoin = getChain(chain.id).exitStablecoinAddress;
    if (!stablecoin) throw new Error(`No exit stablecoin address is registered for ${chain.name}.`);
    const signer = await getSignerForChain(password, chain.id);
    const { txHash, lockId } = await createLockOnChain(signer, {
      chainId: chain.id,
      // Vault address from the merged admin registry: a vault registered
      // in Contract Studio is used here on the next admin sync.
      vaultAddress: chain.vaultContract,
      tokenAddress: token.address,
      tokenDecimals: token.decimals,
      stablecoinAddress: stablecoin,
      amount: amt,
      unlockTime,
      entryPriceUsd: entryPrice,
      ladder: ladderOn ? ladder : target !== null ? [{ multiple: target, percent: 100 }] : [],
      trailingStopBps: trailingAllowed ? trailing : null,
      breakMode,
      penaltyBps: breakMode === 'penalty' ? Math.round(fees.defaultPenaltyPct * 100) : 0,
      autoSell: preview.autoSell,
      slippageBps,
      minReceiveUsd: preview.minReceiveUsd,
    });
    return { hash: txHash, blockNumber: null, lockId };
  }

  async function onLockSigned(res: SignTxResult) {
    if (!token) return;
    const lock: BullLock = {
      ...preview,
      id: res.lockId !== null && res.lockId !== undefined ? `onchain-${chain.id}-${res.lockId}` : `onchain-${chain.id}-tx-${res.hash.slice(2, 10)}`,
      txHash: res.hash,
    };
    addLock(lock);
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'lock',
      token: token.symbol,
      amount: amt,
      amountRaw: String(amt),
      usd: amt * entryPrice,
      note: `Locked on-chain until ${new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${target ? ` or ${target}x` : ''} · vault ${vaultStatus.deployed ? vaultStatus.address : ''}`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: chain.id,
      blockNumber: null,
    });
    setCreated(lock);
    await refreshLocks();
  }

  if (created) {
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
          <Card style={styles.done}>
            <Text style={styles.doneTitle}>Lock created on-chain</Text>
            <Text style={styles.doneBody}>Lock ID {created.id}</Text>
            <Text style={styles.doneBody}>Receipt: {fmtNum(created.amount)} {created.tokenSymbol} · {fmtUsd(created.amount * created.entryPrice)}</Text>
            <Text style={styles.doneBody}>Unlock: {new Date(created.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            <Text style={styles.doneBody}>Tx: {created.txHash ? `${created.txHash.slice(0, 12)}…${created.txHash.slice(-6)}` : '—'}</Text>
            <Text style={styles.doneBody}>Maturity and target alerts will appear in Notifications as the lock progresses.</Text>
          </Card>
          <Btn label="View Lock" onPress={() => router.replace(`/vault/${created.id}`)} />
          <Btn label="Back to Vault" variant="ghost" onPress={() => router.replace('/(tabs)/vault')} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
        <Text style={styles.title}>Create Lock</Text>
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
            {tokens.filter((t) => !t.isSpam).length === 0 && <Text style={styles.hint}>No tokens yet — receive funds first.</Text>}
            <SectionTitle title="Amount to lock" />
            <TextInput style={styles.amountInput} keyboardType="decimal-pad" placeholder="0.0" value={amount} onChangeText={setAmount} />
            <View style={styles.pctRow}>
              {[25, 50, 75, 100].map((p) => (
                <Btn key={p} label={`${p}%`} variant="ghost" onPress={() => token && setAmount(String((spendable * p) / 100))} style={styles.pctBtn} />
              ))}
            </View>
            {token && (
              <Text style={styles.hint}>
                Spendable: {fmtNum(spendable)} {token.symbol} ({fmtUsd(spendable * (token.price ?? 0))}) · after lock:{' '}
                {fmtUsd(Math.max(0, spendable - amt) * (token.price ?? 0))}
              </Text>
            )}
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
                  <Text style={styles.targetText}>Est. value at target: {fmtUsd(amt * (targetPrice ?? entryPrice))}</Text>
                </Card>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <SectionTitle title="On target hit" />
            <View style={styles.pills}>
              <Btn label={`${exitLabel} (auto-sell)`} variant={autoSell && autoSellAllowed ? 'mint' : 'ghost'} onPress={() => setAutoSell(true)} disabled={!autoSellAllowed} style={styles.wideBtn} />
              <Btn label="Unlock to wallet (manual)" variant={!autoSell ? 'primary' : 'ghost'} onPress={() => setAutoSell(false)} style={styles.wideBtn} />
            </View>
            {!autoSellAllowed ? (
              <Text style={styles.hint}>Auto-sell is switched off by the admin — target hits unlock to your wallet instead.</Text>
            ) : null}
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
              {trailingOptions.map((o) => (
                <Btn key={o.label} label={o.label} variant={trailing === o.v ? 'primary' : 'ghost'} onPress={() => setTrailing(o.v)} disabled={!trailingAllowed} style={styles.pill} />
              ))}
            </View>
            <Text style={styles.hint}>
              After any target is hit, a fall of the chosen % from the peak auto-sells the remainder {exitLabel}. Slippage
              default {fees.defaultSlippagePct}% · minimum receive shown at review.
              {!trailingAllowed ? ' Trailing stop is switched off by the admin.' : ''}
            </Text>
            <SectionTitle title="Break mode" />
            <View style={styles.pills}>
              <Btn label="Immutable (strongest)" variant={breakMode === 'immutable' ? 'primary' : 'ghost'} onPress={() => setBreakMode('immutable')} style={styles.wideBtn} />
              <Btn label={`Penalty break (${fees.defaultPenaltyPct}%, 24h cooling-off)`} variant={breakMode === 'penalty' ? 'primary' : 'ghost'} onPress={() => setBreakMode('penalty')} style={styles.wideBtn} />
              <Btn label="Guardian break (Phase 2)" variant={breakMode === 'guardian' ? 'primary' : 'ghost'} onPress={() => setBreakMode('guardian')} style={styles.wideBtn} />
            </View>
            <Text style={styles.hint}>No penalty is ever charged when a price target or the maturity date triggers the exit. Penalty default is {fees.defaultPenaltyPct}%{adminFees.source === 'admin' ? ' (set by admin)' : ' (app default — no admin fee published yet)'}.</Text>
          </>
        )}

        {step === 4 && (
          <>
            <Card dark>
              <Text style={styles.reviewTitle}>Review your lock</Text>
              <ReviewRow label="Token" value={`${fmtNum(amt)} ${token?.symbol ?? symbol} (${fmtUsd(amt * entryPrice)})`} />
              <ReviewRow label="Chain" value={`${chain.name}${chain.testnet ? ' (testnet)' : ''}`} />
              <ReviewRow label="Vault contract" value={vaultStatus.deployed ? vaultStatus.address : 'Not deployed yet — testnet deploy required'} />
              <ReviewRow label="Unlock date" value={new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <ReviewRow label="Target" value={targetPrice ? `${target}x · ${fmtPrice(targetPrice)}` : 'None — date lock'} />
              <ReviewRow label="Exit" value={targetPrice ? (autoSell ? exitLabel : 'Unlock to wallet') : 'Unlock to wallet'} />
              <ReviewRow label="Ladder" value={ladderOn ? ladder.map((s) => `${s.percent}% @ ${s.multiple}x`).join(' · ') : 'Off'} />
              <ReviewRow label="Trailing stop" value={trailing ? `${trailing / 100}%` : 'Off'} />
              <ReviewRow label="Break mode" value={breakMode === 'immutable' ? 'Immutable — no early break' : breakMode === 'penalty' ? `Penalty break — ${fees.defaultPenaltyPct}% after 24h cooling-off` : 'Guardian break — approval + 48h delay'} />
              <ReviewRow label="Slippage" value={`${fees.defaultSlippagePct}%${adminFees.source === 'admin' ? ' (set by admin)' : ' (app default — no admin fee published yet)'}`} />
              <ReviewRow label="Minimum receive" value={targetPrice ? fmtUsd(minReceiveUsd) : '—'} />
              <ReviewRow label="Stelix fee" value={feeLabel} />
              <ReviewRow label="Network fee" value="Shown by the wallet before signing" />
            </Card>
            <Text style={styles.sentence}>{lockSummarySentence(preview, exitLabel)}</Text>
            <Text style={styles.hint}>Review the terms above, then confirm in the signing sheet — your session password authorises the lock.</Text>
          </>
        )}

        {formError ? <Text style={styles.error}>{formError}</Text> : null}

        <View style={styles.nav}>
          {step > 1 && <Btn label="Back" variant="ghost" onPress={() => setStep((s) => s - 1)} style={styles.navBtn} />}
          {step < 4 ? (
            <Btn label="Continue" onPress={next} style={styles.navBtn} />
          ) : (
            <Btn label="Confirm Lock" variant="mint" onPress={() => void confirm()} style={styles.navBtn} />
          )}
        </View>
        <RiskNote />

        <SignTransactionModal
          visible={signModal !== null}
          request={signModal}
          biometricsEnabled={settings.biometrics}
          onClose={() => setSignModal(null)}
          onSign={signLock}
          onSigned={(res) => void onLockSigned(res)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
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
  amountInput: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 20, fontWeight: '800', padding: 12 },
  done: { backgroundColor: COLORS.mintSoft },
  doneBody: { color: COLORS.mintDark, fontSize: 12, lineHeight: 18, marginTop: 4 },
  doneTitle: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  dot: { backgroundColor: COLORS.border, borderRadius: 999, flex: 1, height: 6 },
  dotOn: { backgroundColor: COLORS.mint },
  error: { color: COLORS.red, fontSize: 12, marginTop: 8 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 12 },
  input: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 14, marginTop: 8, padding: 12 },
  label: { color: COLORS.text, fontSize: 12, fontWeight: '700', marginTop: 14 },
  ladderInput: { backgroundColor: COLORS.bgMuted, borderRadius: 8, fontSize: 14, padding: 8, textAlign: 'center', width: 64 },
  ladderLabel: { color: COLORS.text, fontSize: 14, fontWeight: '700', width: 48 },
  ladderPct: { color: COLORS.textMuted, fontSize: 14 },
  ladderRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 6 },
  nav: { flexDirection: 'row', gap: 8, marginTop: 16 },
  navBtn: { flex: 1 },
  pctBtn: { flex: 1, minHeight: 36 },
  pctRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pill: { minHeight: 36, paddingHorizontal: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 10 },
  reviewLabel: { color: COLORS.textOnNavyMuted, flexShrink: 0, fontSize: 12 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  reviewTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 6 },
  reviewValue: { color: '#fff', flexShrink: 1, fontSize: 12, fontWeight: '700', marginLeft: 12, textAlign: 'right' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sentence: { color: COLORS.text, fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 14 },
  steps: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 4 },
  targetCard: { marginTop: 10 },
  targetText: { color: COLORS.text, fontSize: 12, fontWeight: '700', paddingVertical: 2 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  wideBtn: { minHeight: 36, paddingHorizontal: 10 },
});
