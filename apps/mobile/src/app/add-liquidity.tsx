/** Add Liquidity — seed the STX/USDC Uniswap V3 pool on Arc Mainnet.
 *
 *  The pool token is resolved from the synced admin registry at
 *  runtime (lib/pool.ts resolvePoolToken) — never a hardcoded
 *  address. The new STX token does not exist yet: until it is
 *  deployed from the Launchpad and registered, this screen says so
 *  plainly and there is nothing to seed.
 *
 *  Flow: enter STX + USDC amounts. When the pool already exists the
 *  amounts must match its price (the second amount follows the
 *  first). When it does not exist yet, the RATIO of the two amounts
 *  sets the starting price — shown clearly before signing, because
 *  that first price is the user's decision. A price range (min/max
 *  USDC per STX, default full range) bounds where the position
 *  earns fees. Approve both tokens, then a wallet-signed mint via
 *  the position manager; the position NFT goes to the user's wallet.
 *  Trading fees (0.3% of each swap) go to the position owner.
 *
 *  Signing is fingerprint-first through SignTransactionModal, the
 *  same modal every on-chain action uses. No seed phrase, key or
 *  password is ever shown or stored here. */
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Droplets } from 'lucide-react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import {
  DEFAULT_MINT_SLIPPAGE_BPS,
  POOL_CHAIN_ID,
  POOL_FEE_TIER,
  addLiquidity,
  amountsMatchPrice,
  defaultFullRangeTicks,
  formatTokenAmount,
  getPoolForPair,
  getPoolProvider,
  getPoolQuoteToken,
  getPosition,
  getTokenBalance,
  poolStateToBasePrice,
  priceQuotePerBaseToSqrtPriceX96,
  priceRangeToTicks,
  resolvePoolToken,
  stxForUsdc,
  tickSpacingForFee,
  usdcForStx,
  type LpPosition,
  type PoolState,
  type PoolToken,
} from '../lib/pool';
import { getSignerForChain } from '../lib/signer';
import { getChain } from '../lib/chains';
import { fmtNum, fmtPrice } from '../lib/format';
import { Btn, BottomSheet, Card, SectionTitle } from '../components/ui';
import { BottomNav } from '../components/AppShell';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../components/SignTransactionModal';

function trimNum(n: number, dp: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  return n.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function parseAmount(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function AddLiquidity() {
  const { adminTokens, adminTokensSynced, address: walletAddress, settings, addTx, refreshBalances } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 768;

  // The pool token comes from the registry — null until the new STX
  // token is deployed and registered. Nothing below runs without it.
  const poolToken = useMemo(() => resolvePoolToken(adminTokens), [adminTokens]);
  const quoteToken: PoolToken | null = useMemo(() => {
    try {
      return getPoolQuoteToken();
    } catch {
      return null;
    }
  }, []);
  const chain = getChain(POOL_CHAIN_ID);

  // Address the pool was last loaded for — the load is "done" only
  // when it matches the current pool token. Derived, so the effect
  // below never sets state synchronously (no cascading renders).
  const [poolLoadedFor, setPoolLoadedFor] = useState<string | null>(null);
  const poolChecked = poolToken === null || poolLoadedFor === poolToken.address;
  const [pool, setPool] = useState<{ pool: string; state: PoolState } | null>(null);
  const [baseBalance, setBaseBalance] = useState<number | null>(null);
  const [quoteBalance, setQuoteBalance] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseAmount, setBaseAmount] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signModal, setSignModal] = useState<SignTxRequest | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [mintTokenId, setMintTokenId] = useState<number | null>(null);
  const [position, setPosition] = useState<LpPosition | null>(null);

  const currentPrice = pool && poolToken && quoteToken ? poolStateToBasePrice(pool.state, poolToken, quoteToken) : null;
  const baseNum = parseAmount(baseAmount);
  const quoteNum = parseAmount(quoteAmount);
  // No pool yet: the ratio sets the starting price — shown live.
  const impliedPrice = !pool && baseNum > 0 && quoteNum > 0 ? quoteNum / baseNum : null;
  const showPrice = currentPrice ?? impliedPrice;

  useEffect(() => {
    let cancelled = false;
    if (!poolToken || !quoteToken) return;
    void (async () => {
      try {
        const provider = getPoolProvider();
        const found = await getPoolForPair(provider, poolToken, quoteToken);
        let baseBal: bigint | null = null;
        let quoteBal: bigint | null = null;
        if (walletAddress) {
          baseBal = await getTokenBalance(provider, poolToken.address, walletAddress);
          // USDC is Arc's native gas asset: the native balance IS the
          // USDC balance.
          quoteBal = await provider.getBalance(walletAddress);
        }
        if (cancelled) return;
        setPool(found);
        setBaseBalance(baseBal === null ? null : Number(formatTokenAmount(baseBal, poolToken.decimals)));
        setQuoteBalance(quoteBal === null ? null : Number(formatTokenAmount(quoteBal, quoteToken.decimals)));
        setLoadError(null);
        setPoolLoadedFor(poolToken.address);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Could not load the pool.');
          setPoolLoadedFor(poolToken.address);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poolToken, quoteToken, walletAddress]);

  // --- Amount entry -------------------------------------------------------
  // Pool exists: the second amount follows the first at the pool
  // price. No pool: both amounts are free — their ratio is the
  // starting price.
  function onBaseChange(v: string) {
    setBaseAmount(v);
    setError(null);
    if (currentPrice !== null) {
      const n = parseAmount(v);
      setQuoteAmount(n > 0 ? trimNum(usdcForStx(n, currentPrice), 6) : '');
    }
  }

  function onQuoteChange(v: string) {
    setQuoteAmount(v);
    setError(null);
    if (currentPrice !== null) {
      const n = parseAmount(v);
      setBaseAmount(n > 0 ? trimNum(stxForUsdc(n, currentPrice), 6) : '');
    }
  }

  function setPct(pct: number, which: 'base' | 'quote') {
    if (which === 'base' && baseBalance !== null) onBaseChange(trimNum((baseBalance * pct) / 100, 6));
    if (which === 'quote' && quoteBalance !== null) onQuoteChange(trimNum((quoteBalance * pct) / 100, 6));
  }

  // --- Range ---------------------------------------------------------------
  // Empty min/max = full range. Otherwise both are required and the
  // range must contain the current / starting price.
  function rangeTicks(): { tickLower: number; tickUpper: number } | null {
    if (!poolToken || !quoteToken) return null;
    const spacing = tickSpacingForFee(POOL_FEE_TIER);
    if (spacing === null) return null;
    if (minPrice.trim() === '' && maxPrice.trim() === '') {
      return defaultFullRangeTicks(spacing);
    }
    const min = parseAmount(minPrice);
    const max = parseAmount(maxPrice);
    if (!(min > 0) || !(max > min)) return null;
    try {
      return priceRangeToTicks(min, max, poolToken, quoteToken, spacing);
    } catch {
      return null;
    }
  }

  const range = rangeTicks();
  const rangeLabel =
    minPrice.trim() === '' && maxPrice.trim() === ''
      ? 'Full range'
      : range !== null
        ? `${fmtPrice(parseAmount(minPrice))} – ${fmtPrice(parseAmount(maxPrice))} ${quoteToken?.symbol ?? ''} per ${poolToken?.symbol ?? ''}`
        : 'Invalid range';

  // --- Validation ----------------------------------------------------------
  function validate(): string | null {
    if (!poolToken || !quoteToken) return 'No token is configured for the pool yet.';
    if (!(baseNum > 0) || !(quoteNum > 0)) return 'Enter both amounts above 0.';
    if (baseBalance !== null && baseNum > baseBalance) {
      return `You only have ${fmtNum(baseBalance, 4)} ${poolToken.symbol}.`;
    }
    if (quoteBalance !== null && quoteNum > quoteBalance) {
      return `You only have ${fmtNum(quoteBalance, 2)} ${quoteToken.symbol}.`;
    }
    if (pool && currentPrice !== null) {
      if (!amountsMatchPrice(quoteNum, baseNum, currentPrice)) {
        return 'The amounts do not match the pool price — adjust one amount so the ratio matches.';
      }
    }
    if (!pool && impliedPrice === null) return 'Enter both amounts — their ratio sets the starting price.';
    if (minPrice.trim() !== '' || maxPrice.trim() !== '') {
      if (range === null) return 'Enter a valid price range (min above 0 and below max).';
      const p = showPrice;
      if (p !== null && (p <= parseAmount(minPrice) || p >= parseAmount(maxPrice))) {
        return 'The price is outside your range — widen the range or it earns no fees.';
      }
    }
    if (range === null) return 'Price range could not be built — try the full range.';
    return null;
  }

  function review() {
    const err = validate();
    setError(err);
    if (err) return;
    setReviewOpen(true);
  }

  function confirmReview() {
    if (!poolToken || !quoteToken || !range) return;
    setReviewOpen(false);
    setError(null);
    const price = showPrice;
    setSignModal({
      title: 'Confirm Add Liquidity',
      actionLabel: 'Sign & Add Liquidity',
      fromAddress: walletAddress,
      toAddress: '0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377',
      toLabel: 'Uniswap V3 position manager',
      network: `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
      rows: [
        { label: 'You add', value: `${fmtNum(baseNum, 4)} ${poolToken.symbol} + ${fmtNum(quoteNum, 2)} ${quoteToken.symbol}` },
        {
          label: pool ? 'Current price' : 'Starting price',
          value: price !== null ? `${fmtPrice(price)} ${quoteToken.symbol} per ${poolToken.symbol}` : '—',
        },
        { label: 'Price range', value: rangeLabel },
        { label: 'Fee tier', value: '0.3% of each swap' },
        { label: 'You receive', value: 'A liquidity position (NFT) in your wallet' },
        { label: 'Trading fees', value: '0.3% of swaps in this pool go to the position owner — you' },
        { label: 'Slippage guard', value: `${DEFAULT_MINT_SLIPPAGE_BPS / 100}% on min amounts` },
        { label: 'Network fee', value: 'Estimated at signing' },
      ],
      warning: pool
        ? 'You approve both tokens, then the position is minted. The amounts must match the pool price.'
        : 'This pool does not exist yet — your amounts set its first price. Check the starting price above before signing.',
      explorerBase: chain.explorerUrl,
    });
  }

  async function signAddLiquidity(password: string): Promise<SignTxResult> {
    if (!poolToken || !quoteToken || !range) throw new Error('No token is configured for the pool yet.');
    const signer = await getSignerForChain(password, POOL_CHAIN_ID);
    const sqrtPriceX96 = pool
      ? pool.state.sqrtPriceX96
      : priceQuotePerBaseToSqrtPriceX96(impliedPrice as number, poolToken, quoteToken);
    const res = await addLiquidity(signer, {
      poolToken,
      quoteToken,
      baseAmount,
      quoteAmount,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      sqrtPriceX96,
    });
    return { hash: res.txHash, blockNumber: null, lockId: res.tokenId };
  }

  async function onSigned(res: SignTxResult) {
    if (!poolToken || !quoteToken) return;
    setMintTxHash(res.hash);
    setMintTokenId(res.lockId ?? null);
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'other',
      token: poolToken.symbol,
      amount: baseNum,
      amountRaw: '',
      usd: showPrice !== null ? baseNum * showPrice + quoteNum : quoteNum,
      note: `Added ${fmtNum(baseNum, 4)} ${poolToken.symbol} + ${fmtNum(quoteNum, 2)} ${quoteToken.symbol} liquidity${res.lockId !== null && res.lockId !== undefined ? ` · position #${res.lockId}` : ''}`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: POOL_CHAIN_ID,
      blockNumber: null,
    });
    await refreshBalances();
    if (res.lockId !== null && res.lockId !== undefined) {
      try {
        const pos = await getPosition(getPoolProvider(), res.lockId, poolToken, quoteToken);
        setPosition(pos);
      } catch {
        // Position read failed — the tx hash still identifies it.
      }
    }
  }

  // --- No token configured yet ---------------------------------------------
  if (!adminTokensSynced) {
    return (
      <View style={styles.shell}>
        <View style={[styles.center, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
          <Text style={styles.title}>Add Liquidity</Text>
          <Text style={styles.centerBody}>Checking the token registry…</Text>
        </View>
        <BottomNav />
      </View>
    );
  }

  if (!poolToken || !quoteToken) {
    return (
      <View style={styles.shell}>
        <View style={[styles.center, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" style={styles.backBtn}>
            <ChevronLeft size={22} color={COLORS.text} />
          </Pressable>
          <View style={styles.centerInner}>
            <Droplets size={28} color={COLORS.mint} />
            <Text style={styles.title}>No token to add liquidity for yet</Text>
            <Text style={styles.centerBody}>
              The new STX token has not been deployed and registered yet, so there is no pool to seed. Once it
              appears in the token registry, you can add its first liquidity here.
            </Text>
            <Btn label="Back" onPress={() => router.back()} />
          </View>
        </View>
        <BottomNav />
      </View>
    );
  }

  // --- Position minted ------------------------------------------------------
  if (mintTxHash) {
    return (
      <View style={styles.shell}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.inner, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom, ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null) }]}
        >
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" style={styles.backBtn}>
            <ChevronLeft size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.title}>Liquidity added</Text>
          <Text style={styles.sub}>Your position is live on Arc Mainnet.</Text>
          <Card style={styles.doneCard}>
            <Text style={styles.doneLabel}>Position NFT</Text>
            <Text style={styles.doneValue}>{mintTokenId !== null ? `#${mintTokenId}` : 'See transaction'}</Text>
            <Text style={styles.doneLabel}>You added</Text>
            <Text style={styles.doneValue}>
              {fmtNum(baseNum, 4)} {poolToken.symbol} + {fmtNum(quoteNum, 2)} {quoteToken.symbol}
            </Text>
            <Text style={styles.doneLabel}>Price range</Text>
            <Text style={styles.doneValue}>{rangeLabel}</Text>
            {position?.minPriceQuotePerBase !== null && position?.minPriceQuotePerBase !== undefined ? (
              <>
                <Text style={styles.doneLabel}>Range on-chain</Text>
                <Text style={styles.doneValue}>
                  {fmtPrice(position.minPriceQuotePerBase)} – {fmtPrice(position.maxPriceQuotePerBase as number)} {quoteToken.symbol} per {poolToken.symbol}
                </Text>
              </>
            ) : null}
            <Text style={styles.doneHint}>
              Trading fees (0.3% of each swap in this pool) go to you as the position owner. The transaction is
              in your History.
            </Text>
          </Card>
          <Btn label="Done" variant="mint" onPress={() => router.back()} style={styles.doneBtn} />
        </ScrollView>
        <BottomNav />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.inner, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom, ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null) }]}
        >
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" style={styles.backBtn}>
            <ChevronLeft size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.title}>Add Liquidity</Text>
          <Text style={styles.sub}>
            {poolToken.symbol} / {quoteToken.symbol} · {chain.name} · 0.3% fee tier
          </Text>

          {!poolChecked ? (
            <Card style={styles.noteCard}>
              <Text style={styles.noteText}>Checking whether the pool exists…</Text>
            </Card>
          ) : loadError ? (
            <Card style={styles.warnCard}>
              <Text style={styles.warnText}>Could not load the pool: {loadError}</Text>
            </Card>
          ) : pool ? (
            <Card style={styles.noteCard}>
              <Text style={styles.noteText}>
                Pool exists — current price {currentPrice !== null ? fmtPrice(currentPrice) : '—'} {quoteToken.symbol} per{' '}
                {poolToken.symbol}. Amounts must match this price.
              </Text>
            </Card>
          ) : (
            <Card style={styles.warnCard}>
              <Text style={styles.warnTitle}>This pool does not exist yet</Text>
              <Text style={styles.warnText}>
                You are seeding the first liquidity. The ratio of the two amounts below sets the starting price —
                check it before signing.
              </Text>
            </Card>
          )}

          <SectionTitle title={`${poolToken.symbol} amount`} />
          <Card>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
                value={baseAmount}
                onChangeText={onBaseChange}
              />
              <Text style={styles.amountSym}>{poolToken.symbol}</Text>
            </View>
            <Text style={styles.hint}>
              Balance: {baseBalance === null ? '—' : `${fmtNum(baseBalance, 4)} ${poolToken.symbol}`}
            </Text>
            <View style={styles.pctRow}>
              {[25, 50, 75, 100].map((p) => (
                <Pressable key={p} onPress={() => setPct(p, 'base')} style={styles.pctBtn}>
                  <Text style={styles.pctBtnText}>{p}%</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <SectionTitle title={`${quoteToken.symbol} amount`} />
          <Card>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
                value={quoteAmount}
                onChangeText={onQuoteChange}
              />
              <Text style={styles.amountSym}>{quoteToken.symbol}</Text>
            </View>
            <Text style={styles.hint}>
              Balance: {quoteBalance === null ? '—' : `${fmtNum(quoteBalance, 2)} ${quoteToken.symbol}`}
            </Text>
            <View style={styles.pctRow}>
              {[25, 50, 75, 100].map((p) => (
                <Pressable key={p} onPress={() => setPct(p, 'quote')} style={styles.pctBtn}>
                  <Text style={styles.pctBtnText}>{p}%</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <SectionTitle title={pool ? 'Current price' : 'Starting price'} />
          <Card>
            <Text style={styles.priceBig}>
              {showPrice !== null ? `${fmtPrice(showPrice)} ${quoteToken.symbol} per ${poolToken.symbol}` : '—'}
            </Text>
            <Text style={styles.hint}>
              {pool
                ? 'From the pool — your amounts follow this price.'
                : 'Implied by your amounts — this becomes the pool’s first price when you sign.'}
            </Text>
          </Card>

          <SectionTitle title="Price range (optional)" />
          <Card>
            <Text style={styles.hint}>Leave both empty for the full range. Your position only earns fees while the price stays inside the range.</Text>
            <View style={styles.rangeRow}>
              <View style={styles.rangeField}>
                <Text style={styles.fieldLabel}>Min price</Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="decimal-pad"
                  placeholder="Empty = full range"
                  placeholderTextColor={COLORS.textMuted}
                  value={minPrice}
                  onChangeText={(v) => {
                    setMinPrice(v);
                    setError(null);
                  }}
                />
              </View>
              <View style={styles.rangeField}>
                <Text style={styles.fieldLabel}>Max price</Text>
                <TextInput
                  style={styles.fieldInput}
                  keyboardType="decimal-pad"
                  placeholder="Empty = full range"
                  placeholderTextColor={COLORS.textMuted}
                  value={maxPrice}
                  onChangeText={(v) => {
                    setMaxPrice(v);
                    setError(null);
                  }}
                />
              </View>
            </View>
            <Text style={styles.hint}>Range: {rangeLabel}</Text>
          </Card>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Btn label="Review & Add Liquidity" variant="mint" onPress={review} style={styles.reviewBtn} />
          <Text style={styles.foot}>
            You receive a liquidity position (NFT) in your wallet. Trading fees (0.3% of each swap) go to the
            position owner — you. No fee is charged for adding liquidity.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} title="Review your position">
        <View style={styles.reviewCard}>
          <ReviewRow label="You add" value={`${fmtNum(baseNum, 4)} ${poolToken.symbol} + ${fmtNum(quoteNum, 2)} ${quoteToken.symbol}`} />
          <ReviewRow label={pool ? 'Current price' : 'Starting price'} value={showPrice !== null ? `${fmtPrice(showPrice)} ${quoteToken.symbol} per ${poolToken.symbol}` : '—'} />
          <ReviewRow label="Price range" value={rangeLabel} />
          <ReviewRow label="Fee tier" value="0.3% of each swap" />
          <ReviewRow label="You receive" value="Liquidity position (NFT)" />
          <ReviewRow label="Trading fees" value="Go to the position owner — you" />
        </View>
        <Text style={styles.reviewHint}>
          Review the amounts and the {pool ? 'current' : 'starting'} price above, then confirm in the signing
          sheet — your session password authorises the mint.
        </Text>
        <Btn label="Confirm" variant="mint" onPress={confirmReview} style={styles.confirmBtn} />
      </BottomSheet>

      <SignTransactionModal
        visible={signModal !== null}
        request={signModal}
        biometricsEnabled={settings.biometrics}
        onClose={() => setSignModal(null)}
        onSign={signAddLiquidity}
        onSigned={(res) => void onSigned(res)}
      />
      <BottomNav />
    </View>
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
  amountInput: { color: COLORS.text, flex: 1, fontSize: 16, fontWeight: '800' },
  amountRow: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  amountSym: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  backBtn: { alignItems: 'center', alignSelf: 'flex-start', justifyContent: 'center', marginBottom: 12 },
  center: { backgroundColor: COLORS.bg, flex: 1, padding: 16 },
  centerBody: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: 'center' },
  centerInner: { alignItems: 'center', flex: 1, gap: 4, justifyContent: 'center', paddingHorizontal: 16 },
  confirmBtn: { marginTop: 14 },
  doneBtn: { marginTop: 14 },
  doneCard: { gap: 4, marginTop: 12 },
  doneHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  doneLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  doneValue: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  error: { color: COLORS.red, fontSize: 13, fontWeight: '600', marginTop: 10 },
  fieldInput: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 12,
    color: COLORS.text,
    fontSize: 14,
    marginTop: 6,
    padding: 10,
  },
  fieldLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  foot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  inner: { padding: 12 },
  noteCard: { backgroundColor: COLORS.mintSoft, marginTop: 12 },
  noteText: { color: COLORS.mintDark, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  pctBtn: { alignItems: 'center', backgroundColor: COLORS.bgMuted, borderRadius: 999, flex: 1, paddingVertical: 8 },
  pctBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  pctRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  priceBig: { color: COLORS.mintDark, fontSize: 18, fontWeight: '800' },
  rangeField: { flex: 1 },
  rangeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  reviewBtn: { marginTop: 14 },
  reviewCard: { backgroundColor: COLORS.navy, borderRadius: 12, marginTop: 10, padding: 12 },
  reviewHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  reviewLabel: { color: COLORS.textOnNavyMuted, flexShrink: 0, fontSize: 12 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  reviewValue: { color: '#fff', flexShrink: 1, fontSize: 12, fontWeight: '700', marginLeft: 12, textAlign: 'right' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  shell: { backgroundColor: COLORS.bg, flex: 1 },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  warnCard: { backgroundColor: COLORS.amberSoft, marginTop: 12 },
  warnText: { color: '#92400E', fontSize: 12, lineHeight: 17, marginTop: 4 },
  warnTitle: { color: '#92400E', fontSize: 13, fontWeight: '800' },
});
