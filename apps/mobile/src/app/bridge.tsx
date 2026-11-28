/** Bridge USDC — move native USDC between supported chains (Circle CCTP V2).
 *
 *  USDC ONLY. Three steps, each explained before signing:
 *   1. Burn — approve + burn USDC on the source chain (one signing).
 *   2. Wait — the burn is confirmed for the destination (usually
 *      seconds from Arc, up to ~20 minutes from Ethereum or Base).
 *   3. Collect — mint the same USDC on the destination chain (one signing).
 *  Gas is paid on BOTH chains, so both legs are shown before signing.
 *  Standard transfers are free — only gas is charged. Fast is optional
 *  where offered, with the live fee fetched and shown before signing.
 *  Signing uses the self-custody wallet on both legs; there is no
 *  password field on this page — signing happens only in the shared
 *  SignTransactionModal. If the page is left mid-transfer, the burn
 *  transaction stays in History and collection can be resumed from it. */
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownUp, ChevronDown } from 'lucide-react-native';
import { ethers } from 'ethers';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtNum, fmtUsd } from '../lib/format';
import { getSignerForChain } from '../lib/signer';
import { getChain } from '../lib/chains';
import { getProvider } from '../lib/balances';
import {
  applyBridgeFee,
  approveUsdcIfNeeded,
  burnUsdc,
  estimateBurnGas,
  estimateMintGas,
  fetchFastFee,
  getUsdcBalance,
  mintUsdc,
  pollAttestation,
  resolveBridgeFee,
  supportedBridgeChains,
  transferUsdc,
  CCTP_FINALITY_FAST,
  CCTP_FINALITY_STANDARD,
  CCTP_V2_ADDRESSES,
  USDC_DECIMALS,
  type Attestation,
  type CctpChain,
  type FastFeeInfo,
} from '../lib/cctp';
import { BottomSheet, Btn, Card, EmptyState, ScreenHeader } from '../components/ui';
import { BottomNav } from '../components/AppShell';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../components/SignTransactionModal';

type Phase = 'form' | 'waiting' | 'ready' | 'done';
type Speed = 'standard' | 'fast';

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export default function Bridge() {
  const { availableChains, chain, address, settings, adminFees, addTx, refreshBalances } = useApp();
  const insets = useSafeAreaInsets();

  const chains = useMemo(() => supportedBridgeChains(availableChains), [availableChains]);
  const [sourceId, setSourceId] = useState<string>(() =>
    chains.some((c) => c.id === chain.id) ? chain.id : (chains[0]?.id ?? ''),
  );
  const [destId, setDestId] = useState<string>(() => chains.find((c) => c.id !== sourceId)?.id ?? '');
  const [amount, setAmount] = useState('');
  const [speed, setSpeed] = useState<Speed>('standard');
  const [pickerSide, setPickerSide] = useState<'source' | 'dest' | null>(null);

  // undefined = still checking, null = unavailable.
  const [balance, setBalance] = useState<bigint | null | undefined>(undefined);
  const [fastFee, setFastFee] = useState<FastFeeInfo | null>(null);
  const [burnGas, setBurnGas] = useState<{ feeNative: string; symbol: string } | null>(null);
  const [mintGas, setMintGas] = useState<{ feeNative: string; symbol: string } | null>(null);
  const [formError, setFormError] = useState('');

  const [phase, setPhase] = useState<Phase>('form');
  const [burnHash, setBurnHash] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);
  const [pollError, setPollError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [burnModal, setBurnModal] = useState<SignTxRequest | null>(null);
  const [mintModal, setMintModal] = useState<SignTxRequest | null>(null);

  const source: CctpChain | undefined = chains.find((c) => c.id === sourceId);
  const dest: CctpChain | undefined = chains.find((c) => c.id === destId);
  const amt = parseFloat(amount) || 0;
  const bridgeFee = useMemo(() => resolveBridgeFee(adminFees), [adminFees]);
  const amountRaw: bigint | null = useMemo(() => {
    if (amt <= 0) return null;
    try {
      return ethers.parseUnits(amount, USDC_DECIMALS);
    } catch {
      return null;
    }
  }, [amt, amount]);
  const feeSplit = useMemo(
    () => (amountRaw !== null ? applyBridgeFee(amountRaw, bridgeFee.feeBps) : null),
    [amountRaw, bridgeFee.feeBps],
  );
  const fastFeeAmount: bigint | null =
    speed === 'fast' && source?.fastAsSource
      ? (fastFee?.maxFee ?? fastFee?.minFee ?? null)
      : null;
  const receiveRaw: bigint | null =
    feeSplit !== null ? feeSplit.burnAmount - (fastFeeAmount ?? 0n) : null;
  const receiveHuman: number | null =
    receiveRaw !== null ? Number(ethers.formatUnits(receiveRaw, USDC_DECIMALS)) : null;
  const balanceHuman: number | null =
    balance !== null && balance !== undefined
      ? Number(ethers.formatUnits(balance, USDC_DECIMALS))
      : null;

  // --- Source USDC balance ---------------------------------------------
  useEffect(() => {
    if (!source || !address) return;
    let cancelled = false;
    void getUsdcBalance(source.id, address)
      .then((b) => {
        if (!cancelled) setBalance(b);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, address]);

  // --- Live Fast fee (only when Fast is offered from the source) -------
  useEffect(() => {
    if (speed !== 'fast' || !source || !dest || !source.fastAsSource) return;
    let cancelled = false;
    void fetchFastFee({ sourceDomain: source.domain, destinationDomain: dest.domain }).then((f) => {
      if (!cancelled) setFastFee(f);
    });
    return () => {
      cancelled = true;
    };
  }, [speed, source, dest]);

  // --- Source gas estimate ----------------------------------------------
  useEffect(() => {
    if (!source || !dest || amountRaw === null || feeSplit === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const gas = await estimateBurnGas(source.id, address, {
          amountRaw: feeSplit.burnAmount,
          destinationDomain: dest.domain,
          mintRecipient: address,
          burnToken: source.usdcAddress,
          maxFee: fastFeeAmount ?? 0n,
          minFinalityThreshold: speed === 'fast' ? CCTP_FINALITY_FAST : CCTP_FINALITY_STANDARD,
        });
        if (cancelled || gas === null) {
          if (!cancelled) setBurnGas(null);
          return;
        }
        const provider = getProvider(getChain(source.id));
        const feeData = await provider.getFeeData();
        const price = feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
        if (cancelled) return;
        setBurnGas(
          price !== null
            ? { feeNative: ethers.formatEther(gas * price), symbol: getChain(source.id).nativeSymbol }
            : null,
        );
      } catch {
        if (!cancelled) setBurnGas(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, dest?.id, amountRaw, speed]);

  // --- Destination gas estimate (only once the attestation exists) -----
  useEffect(() => {
    if (phase !== 'ready' || !dest || !attestation) return;
    let cancelled = false;
    void (async () => {
      try {
        const gas = await estimateMintGas(dest.id, address, attestation.message, attestation.attestation);
        if (cancelled || gas === null) {
          if (!cancelled) setMintGas(null);
          return;
        }
        const provider = getProvider(getChain(dest.id));
        const feeData = await provider.getFeeData();
        const price = feeData.gasPrice ?? feeData.maxFeePerGas ?? null;
        if (cancelled) return;
        setMintGas(
          price !== null
            ? { feeNative: ethers.formatEther(gas * price), symbol: getChain(dest.id).nativeSymbol }
            : null,
        );
      } catch {
        if (!cancelled) setMintGas(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dest?.id, attestation]);

  // --- Attestation polling ----------------------------------------------
  useEffect(() => {
    if (phase !== 'waiting' || !source || !burnHash) return;
    let cancelled = false;
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    void pollAttestation({ sourceDomain: source.domain, txHash: burnHash })
      .then((a) => {
        if (cancelled) return;
        setAttestation(a);
        setPollError('');
        setPhase('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setPollError(e instanceof Error ? e.message : 'Confirmation check failed.');
      })
      .finally(() => clearInterval(tick));
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, burnHash]);

  function flip() {
    if (!source || !dest) return;
    setSourceId(dest.id);
    setDestId(source.id);
    setBalance(undefined);
    setBurnGas(null);
    setFormError('');
  }

  function pickChain(id: string) {
    if (pickerSide === 'source') {
      if (id === destId) setDestId(sourceId);
      setSourceId(id);
    } else if (pickerSide === 'dest') {
      if (id === sourceId) setSourceId(destId);
      setDestId(id);
    }
    setPickerSide(null);
    setBalance(undefined);
    setBurnGas(null);
    setFormError('');
  }

  function reviewBurn() {
    setFormError('');
    if (!source || !dest) {
      setFormError('Pick a source and a destination chain.');
      return;
    }
    if (source.id === dest.id) {
      setFormError('Source and destination must be different chains.');
      return;
    }
    if (amountRaw === null || amt <= 0) {
      setFormError('Enter a USDC amount to bridge.');
      return;
    }
    if (balance !== null && balance !== undefined && amountRaw > balance) {
      setFormError(
        `Insufficient USDC on ${source.name} — you have ${fmtNum(balanceHuman ?? 0, 2)} USDC.`,
      );
      return;
    }
    if (receiveRaw !== null && receiveRaw <= 0n) {
      setFormError('The amount is too small — fees would leave nothing to receive.');
      return;
    }
    if (speed === 'fast' && fastFeeAmount === null) {
      setFormError('The Fast fee could not be fetched — switch to Standard and try again.');
      return;
    }
    if (!feeSplit) return;
    setBurnModal({
      title: 'Confirm Bridge',
      actionLabel: 'Sign & Burn USDC',
      fromAddress: address,
      toAddress: CCTP_V2_ADDRESSES.tokenMessenger,
      toLabel: 'Circle TokenMessenger',
      network: source.name,
      rows: [
        { label: 'You send', value: `${fmtNum(amt, 2)} USDC · ${source.name}` },
        { label: 'You receive', value: `${fmtNum(receiveHuman ?? 0, 2)} USDC · ${dest.name}` },
        ...(bridgeFee.feeBps > 0
          ? [
              {
                label: 'Bridge fee',
                value: `${fmtNum(Number(ethers.formatUnits(feeSplit.feeAmount, USDC_DECIMALS)), 4)} USDC (${(bridgeFee.feeBps / 100).toFixed(2)}%)`,
              },
            ]
          : []),
        {
          label: 'Speed',
          value:
            speed === 'fast'
              ? `Fast${fastFeeAmount !== null ? ` · fee ≈ ${fmtNum(Number(ethers.formatUnits(fastFeeAmount, USDC_DECIMALS)), 4)} USDC` : ' · fee shown at signing'}`
              : 'Standard · free',
        },
        {
          label: `Gas on ${source.name} (est.)`,
          value: burnGas !== null ? `${fmtNum(parseFloat(burnGas.feeNative), 6)} ${burnGas.symbol}` : 'Estimated at signing',
        },
        {
          label: `Gas on ${dest.name}`,
          value: 'Paid when you collect — estimated then',
        },
        { label: 'Recipient', value: 'Your own address' },
      ],
      warning:
        'Burning is one-way until you collect: the USDC is burned here and can only be minted on the destination with the confirmation. Keep the burn transaction from History until the USDC arrives.',
      explorerBase: getChain(source.id).explorerUrl,
    });
  }

  async function signBurn(password: string): Promise<SignTxResult> {
    if (!source || !dest || !feeSplit || amountRaw === null) throw new Error('No bridge to sign.');
    const signer = await getSignerForChain(password, source.id);
    await approveUsdcIfNeeded(signer, source.id, amountRaw);
    if (feeSplit.feeAmount > 0n && bridgeFee.recipient) {
      await transferUsdc(signer, source.id, bridgeFee.recipient, feeSplit.feeAmount);
    }
    const res = await burnUsdc(signer, source.id, {
      amountRaw: feeSplit.burnAmount,
      destinationDomain: dest.domain,
      mintRecipient: address,
      burnToken: source.usdcAddress,
      maxFee: fastFeeAmount ?? 0n,
      minFinalityThreshold: speed === 'fast' ? CCTP_FINALITY_FAST : CCTP_FINALITY_STANDARD,
    });
    return { hash: res.hash, blockNumber: res.blockNumber };
  }

  async function onBurnSigned(res: SignTxResult) {
    if (!source || !dest) return;
    setBurnHash(res.hash);
    setAttestation(null);
    setMintGas(null);
    setElapsed(0);
    setPollError('');
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'other',
      token: 'USDC',
      amount: amt,
      amountRaw: amountRaw?.toString() ?? '0',
      usd: amt,
      note: `Bridged ${fmtNum(amt, 2)} USDC ${source.name} → ${dest.name} (burn ${shortHash(res.hash)})`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: source.id,
      blockNumber: res.blockNumber ?? null,
    });
    await refreshBalances();
    setPhase('waiting');
  }

  function reviewMint() {
    if (!dest || !attestation || receiveHuman === null) return;
    setMintModal({
      title: 'Collect USDC',
      actionLabel: 'Sign & Collect USDC',
      fromAddress: address,
      toAddress: CCTP_V2_ADDRESSES.messageTransmitter,
      toLabel: 'Circle MessageTransmitter',
      network: dest.name,
      rows: [
        { label: 'You receive', value: `${fmtNum(receiveHuman, 2)} USDC · ${dest.name}` },
        {
          label: `Gas on ${dest.name} (est.)`,
          value: mintGas !== null ? `${fmtNum(parseFloat(mintGas.feeNative), 6)} ${mintGas.symbol}` : 'Estimated at signing',
        },
        { label: 'Burn transaction', value: shortHash(burnHash ?? '') },
        { label: 'Recipient', value: 'Your own address' },
      ],
      explorerBase: getChain(dest.id).explorerUrl,
    });
  }

  async function signMint(password: string): Promise<SignTxResult> {
    if (!dest || !attestation) throw new Error('Nothing to collect yet.');
    const signer = await getSignerForChain(password, dest.id);
    const res = await mintUsdc(signer, dest.id, attestation.message, attestation.attestation);
    return { hash: res.hash, blockNumber: res.blockNumber };
  }

  async function onMintSigned(res: SignTxResult) {
    if (!dest || receiveHuman === null) return;
    setMintHash(res.hash);
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'other',
      token: 'USDC',
      amount: receiveHuman,
      amountRaw: receiveRaw?.toString() ?? '0',
      usd: receiveHuman,
      note: `Received ${fmtNum(receiveHuman, 2)} USDC on ${dest.name} (bridge collect ${shortHash(res.hash)})`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: dest.id,
      blockNumber: res.blockNumber ?? null,
    });
    await refreshBalances();
    setPhase('done');
  }

  const waitMins = Math.floor(elapsed / 60);
  const waitSecs = elapsed % 60;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.inner, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}
      >
        <ScreenHeader title="Bridge USDC" sub="Move USDC between chains" onBack={() => router.back()} />

        {chains.length < 2 ? (
          <EmptyState
            title="Bridging is not available right now"
            body="USDC bridging needs at least two supported chains. Only Arc, Ethereum, Base, Polygon and Plasma can send or receive USDC — BNB cannot, because it has no native USDC to bridge."
            actionLabel="Back to Swap"
            onAction={() => router.back()}
          />
        ) : (
          <>
            <Card style={styles.card}>
              <Text style={styles.cardLabel}>From</Text>
              <Pressable style={styles.chainBtn} onPress={() => setPickerSide('source')}>
                <Text style={styles.chainName}>{source?.name ?? '—'}</Text>
                <ChevronDown size={16} color={COLORS.textMuted} />
              </Pressable>
              <Text style={styles.bal}>
                {balance === undefined
                  ? 'Checking USDC balance…'
                  : balanceHuman !== null
                    ? `Balance: ${fmtNum(balanceHuman, 2)} USDC`
                    : 'Balance unavailable'}
              </Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#CBD5E1"
                  value={amount}
                  onChangeText={(v) => {
                    setAmount(v);
                    setBurnGas(null);
                    setFormError('');
                  }}
                  editable={phase === 'form'}
                />
                <Pressable
                  style={styles.maxBtn}
                  onPress={() => balanceHuman !== null && setAmount(String(balanceHuman))}
                >
                  <Text style={styles.maxText}>MAX</Text>
                </Pressable>
              </View>
              <Text style={styles.tokenPrice}>USDC only — other tokens cannot be bridged.</Text>
            </Card>

            <View style={styles.flipWrap}>
              <Pressable onPress={flip} style={styles.flipBtn}>
                <ArrowDownUp size={18} color={COLORS.navy} />
              </Pressable>
            </View>

            <Card style={styles.card}>
              <Text style={styles.cardLabel}>To</Text>
              <Pressable style={styles.chainBtn} onPress={() => setPickerSide('dest')}>
                <Text style={styles.chainName}>{dest?.name ?? '—'}</Text>
                <ChevronDown size={16} color={COLORS.textMuted} />
              </Pressable>
              <Text style={styles.bal}>
                {receiveHuman !== null && amt > 0
                  ? `You receive ≈ ${fmtNum(receiveHuman, 2)} USDC`
                  : 'Enter an amount to see what you receive'}
              </Text>
            </Card>

            <Card style={styles.card}>
              <Text style={styles.cardLabel}>Speed</Text>
              <View style={styles.speedRow}>
                <Btn
                  label="Standard · Free"
                  variant={speed === 'standard' ? 'primary' : 'ghost'}
                  onPress={() => setSpeed('standard')}
                  style={styles.speedBtn}
                />
                {source?.fastAsSource ? (
                  <Btn
                    label="Fast"
                    variant={speed === 'fast' ? 'primary' : 'ghost'}
                    onPress={() => setSpeed('fast')}
                    style={styles.speedBtn}
                  />
                ) : null}
              </View>
              {speed === 'fast' && source?.fastAsSource ? (
                <Text style={styles.hint}>
                  {fastFeeAmount !== null
                    ? `Fast fee ≈ ${fmtNum(Number(ethers.formatUnits(fastFeeAmount, USDC_DECIMALS)), 4)} USDC, taken from what you receive. Live rate, fetched just now.`
                    : 'Fast fee could not be fetched — switch to Standard to continue.'}
                </Text>
              ) : (
                <Text style={styles.hint}>
                  Standard is free and usually takes seconds from Arc, up to about 20 minutes from Ethereum or Base.
                </Text>
              )}
            </Card>

            {amt > 0 && receiveHuman !== null ? (
              <Card style={styles.card}>
                <QuoteRow label="You send" value={`${fmtNum(amt, 2)} USDC · ${source?.name ?? ''}`} />
                {bridgeFee.feeBps > 0 ? (
                  <QuoteRow label="Bridge fee" value={`${(bridgeFee.feeBps / 100).toFixed(2)}%`} />
                ) : (
                  <QuoteRow label="Bridge fee" value="None" />
                )}
                {speed === 'fast' && fastFeeAmount !== null ? (
                  <QuoteRow
                    label="Fast fee"
                    value={`${fmtNum(Number(ethers.formatUnits(fastFeeAmount, USDC_DECIMALS)), 4)} USDC`}
                  />
                ) : null}
                <QuoteRow label="You receive" value={`${fmtNum(receiveHuman, 2)} USDC · ${dest?.name ?? ''}`} />
                <QuoteRow
                  label={`Gas on ${source?.name ?? ''} (est.)`}
                  value={burnGas !== null ? `${fmtNum(parseFloat(burnGas.feeNative), 6)} ${burnGas.symbol}` : 'Estimated at signing'}
                />
                <QuoteRow label={`Gas on ${dest?.name ?? ''}`} value="Paid when you collect" />
                <QuoteRow label="Value" value={fmtUsd(amt)} />
              </Card>
            ) : null}

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            {phase === 'form' ? (
              <>
                <View style={styles.spacer} />
                <Btn
                  label={amountRaw === null ? 'Enter an amount' : `Bridge ${fmtNum(amt, 2)} USDC`}
                  variant={amountRaw === null ? 'secondary' : 'primary'}
                  onPress={() => void reviewBurn()}
                  disabled={amountRaw === null}
                />
                {burnHash ? (
                  <Btn
                    label="Resume collection"
                    variant="ghost"
                    onPress={() => {
                      setElapsed(0);
                      setPhase('waiting');
                    }}
                    style={{ marginTop: 8 }}
                  />
                ) : null}
              </>
            ) : null}

            {phase === 'waiting' ? (
              <Card style={styles.card}>
                <Text style={styles.waitTitle}>Waiting for confirmation…</Text>
                <Text style={styles.hint}>
                  Burned {fmtNum(amt, 2)} USDC on {source?.name ?? ''}. Confirmation usually takes seconds
                  from Arc and up to about 20 minutes from Ethereum or Base — this page keeps checking.
                </Text>
                <Text style={styles.waitTime}>
                  {waitMins > 0 ? `${waitMins}m ` : ''}{waitSecs}s
                </Text>
                <Text style={styles.hint}>Burn transaction: {shortHash(burnHash ?? '')}</Text>
                {pollError ? <Text style={styles.formError}>{pollError}</Text> : null}
                <Btn label="Stop checking" variant="ghost" onPress={() => setPhase('form')} style={{ marginTop: 12 }} />
              </Card>
            ) : null}

            {phase === 'ready' ? (
              <Card style={styles.card}>
                <Text style={styles.waitTitle}>Ready to collect</Text>
                <Text style={styles.hint}>
                  The burn is confirmed. {fmtNum(receiveHuman ?? 0, 2)} USDC is waiting for you on{' '}
                  {dest?.name ?? ''} — collect it now (destination gas applies).
                </Text>
                <View style={styles.spacer} />
                <Btn label={`Collect ${fmtNum(receiveHuman ?? 0, 2)} USDC on ${dest?.name ?? ''}`} onPress={() => void reviewMint()} />
              </Card>
            ) : null}

            {phase === 'done' ? (
              <Card style={styles.card}>
                <Text style={styles.waitTitle}>USDC received</Text>
                <Text style={styles.hint}>
                  {fmtNum(receiveHuman ?? 0, 2)} USDC arrived on {dest?.name ?? ''}. Both legs are
                  recorded in History.
                </Text>
                <Text style={styles.hint}>Burn: {shortHash(burnHash ?? '')}</Text>
                <Text style={styles.hint}>Collect: {shortHash(mintHash ?? '')}</Text>
                <View style={styles.spacer} />
                <Btn label="Done" onPress={() => router.back()} />
              </Card>
            ) : null}
          </>
        )}

        <BottomSheet visible={pickerSide !== null} onClose={() => setPickerSide(null)} title={pickerSide === 'source' ? 'Bridge from' : 'Bridge to'}>
          {chains.map((c) => {
            const disabled = pickerSide === 'source' ? c.id === destId : c.id === sourceId;
            return (
              <Pressable
                key={c.id}
                style={[styles.pickRow, disabled && styles.pickRowDisabled]}
                onPress={() => {
                  if (!disabled) pickChain(c.id);
                }}
              >
                <View style={styles.pickMid}>
                  <Text style={styles.pickName}>{c.name}</Text>
                  <Text style={styles.pickSub}>Native USDC · Circle CCTP</Text>
                </View>
              </Pressable>
            );
          })}
        </BottomSheet>

        <SignTransactionModal
          visible={burnModal !== null}
          request={burnModal}
          biometricsEnabled={settings.biometrics}
          onClose={() => setBurnModal(null)}
          onSign={signBurn}
          onSigned={(res) => void onBurnSigned(res)}
        />
        <SignTransactionModal
          visible={mintModal !== null}
          request={mintModal}
          biometricsEnabled={settings.biometrics}
          onClose={() => setMintModal(null)}
          onSign={signMint}
          onSigned={(res) => void onMintSigned(res)}
        />
      </ScrollView>
      <BottomNav />
    </KeyboardAvoidingView>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.qRow}>
      <Text style={styles.qLabel}>{label}</Text>
      <Text style={styles.qValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800', minWidth: 0, textAlign: 'right' },
  amountRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  bal: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  card: { marginTop: 12, padding: 12 },
  cardLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chainBtn: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 8 },
  chainName: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  flipBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  flipWrap: { alignItems: 'center', marginVertical: -8, zIndex: 1 },
  formError: { color: COLORS.red, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 12 },
  maxBtn: { backgroundColor: COLORS.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  maxText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  pickMid: { flex: 1, minWidth: 0 },
  pickName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  pickRowDisabled: { opacity: 0.4 },
  pickSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  qLabel: { color: COLORS.textMuted, flexShrink: 0, fontSize: 12, marginRight: 8 },
  qRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  qValue: { color: COLORS.text, flex: 1, flexShrink: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spacer: { flex: 1, minHeight: 24 },
  speedBtn: { flex: 1, minHeight: 36 },
  speedRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tokenPrice: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  waitTime: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  waitTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
});
