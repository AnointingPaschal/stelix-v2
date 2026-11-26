/** Screen 10 — Swap Assets (v1): centred title, 1.5% slippage gear,
 *  chain dropdown, You Pay / You Receive cards, flip button, grey
 *  "Enter Amount" button until an amount is entered. Token pickers are
 *  bottom sheets. No invented fees. */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowDownUp, ChevronDown, Settings } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, fmtUsd } from '../../lib/format';
import { minimumReceive, priceImpactPieces } from '../../lib/vault';
import { fetchTokenMarketData } from '../../lib/prices';
import { executeSwap, getSwapQuote, SwapExecutionNotWiredError } from '../../lib/swap';
import { VAULT_DEFAULTS } from '../../lib/chains';
import { BottomSheet, Btn, Card, NetworkSheet, RiskNote } from '../../components/ui';

export default function Swap() {
  const { tokens, chain } = useApp();
  const spendable = tokens.filter((t) => !t.isSpam && t.balance > 0);
  const all = tokens.filter((t) => !t.isSpam);
  const [from, setFrom] = useState(spendable[0]?.symbol ?? chain.nativeSymbol);
  const [to, setTo] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1.5');
  const [slipOpen, setSlipOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [pickSide, setPickSide] = useState<'from' | 'to' | null>(null);

  const fromToken = tokens.find((t) => t.symbol === from) ?? spendable[0];
  const toToken = tokens.find((t) => t.symbol === to);
  const amt = parseFloat(amount) || 0;

  // Live pool liquidity for the price-impact guard (DexScreener, by the
  // receiving token's contract address). Null = unknown, and the guard
  // then shows "—" instead of inventing a figure.
  const [toLiquidity, setToLiquidity] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setToLiquidity(null);
    if (!toToken?.address) return;
    void fetchTokenMarketData(chain.id, toToken.address).then((d) => {
      if (!cancelled) setToLiquidity(d?.liquidityUsd ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [toToken?.address, chain.id]);

  const quote = useMemo(() => {
    if (!fromToken || !toToken || amt <= 0) return null;
    if (fromToken.price === null || toToken.price === null) return null;
    const usd = amt * fromToken.price;
    const out = toToken.price > 0 ? usd / toToken.price : 0;
    const impact =
      toLiquidity !== null ? priceImpactPieces(usd, toLiquidity, VAULT_DEFAULTS.maxPriceImpactBps) : null;
    return { usd, out, minOut: minimumReceive(out, parseFloat(slippage) * 100 || 150), impact };
  }, [amt, fromToken, toToken, slippage, toLiquidity]);

  function flip() {
    setFrom(to);
    setTo(from);
    setAmount('');
  }

  async function execute() {
    if (!quote || !fromToken || !toToken) return;
    if (amt > fromToken.balance) {
      Alert.alert('Insufficient spendable balance', 'Locked funds cannot be swapped. Only your spendable balance is available.');
      return;
    }
    if (quote.impact && !quote.impact.ok) {
      Alert.alert(
        'High price impact',
        `This swap would move the price ${(quote.impact.impactBps / 100).toFixed(1)}%. The guard splits it into ${quote.impact.pieces} smaller pieces instead of dumping.`,
      );
      return;
    }
    // Swap execution is NOT wired (see lib/swap.ts): this screen shows a
    // live quote only. Never record a swap that was not executed.
    try {
      if (!fromToken.address || !toToken.address) throw new SwapExecutionNotWiredError();
      const liveQuote = await getSwapQuote({
        chainId: chain.id,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        amountIn: amt,
        fromDecimals: fromToken.decimals,
        toDecimals: toToken.decimals,
        slippageBps: Math.round((parseFloat(slippage) || 1.5) * 100),
      });
      await executeSwap(liveQuote);
    } catch (e) {
      Alert.alert(
        'Swap execution is not wired yet',
        e instanceof Error ? e.message : 'No swap was executed.',
      );
    }
  }

  const pickList = pickSide === 'from' ? spendable : all;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <View style={styles.headSide} />
        <Text style={styles.title}>Swap Assets</Text>
        <View style={styles.headRight}>
          <Pressable onPress={() => setSlipOpen(true)} style={styles.gear} hitSlop={6}>
            <Settings size={18} color={COLORS.navy} />
            <View style={styles.slipBadge}>
              <Text style={styles.slipBadgeText}>{slippage}%</Text>
            </View>
          </Pressable>
          <Pressable style={styles.chainBtn} onPress={() => setNetOpen(true)}>
            <Text style={styles.chainText}>{chain.id === 'bnb' ? 'BSC' : chain.name}</Text>
            <ChevronDown size={14} color={COLORS.textMuted} />
          </Pressable>
        </View>
      </View>

      {spendable.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing to swap yet</Text>
          <Text style={styles.emptyBody}>You have no spendable balance on {chain.name}. Receive funds first.</Text>
        </Card>
      ) : (
        <>
          <Card style={styles.payCard}>
            <View style={styles.cardHead}>
              <Text style={styles.cardLabel}>You Pay</Text>
              <Text style={styles.bal}>Bal: {fmtNum(fromToken?.balance ?? 0, 4)} {fromToken?.symbol ?? ''}</Text>
            </View>
            <View style={styles.payRow}>
              <Pressable style={styles.tokenBtn} onPress={() => setPickSide('from')}>
                <View style={styles.tokenAvatar}>
                  <Text style={styles.tokenAvatarText}>{(fromToken?.symbol ?? '?').slice(0, 1)}</Text>
                </View>
                <Text style={styles.tokenSymbol}>{fromToken?.symbol ?? '—'}</Text>
                <ChevronDown size={14} color={COLORS.textMuted} />
              </Pressable>
              <TextInput
                style={styles.amountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#CBD5E1"
                value={amount}
                onChangeText={(v) => {
                  setAmount(v);
                }}
              />
              <Pressable
                style={styles.maxBtn}
                onPress={() => fromToken && setAmount(String(fromToken.balance))}
              >
                <Text style={styles.maxText}>MAX</Text>
              </Pressable>
            </View>
          </Card>

          <View style={styles.flipWrap}>
            <Pressable onPress={flip} style={styles.flipBtn}>
              <ArrowDownUp size={18} color={COLORS.navy} />
            </Pressable>
          </View>

          <Card style={styles.payCard}>
            <Text style={styles.cardLabel}>You Receive</Text>
            <View style={styles.payRow}>
              <Pressable style={styles.tokenBtn} onPress={() => setPickSide('to')}>
                <View style={styles.tokenAvatar}>
                  <Text style={styles.tokenAvatarText}>{(toToken?.symbol ?? '?').slice(0, 1)}</Text>
                </View>
                <Text style={styles.tokenSymbol}>{toToken?.symbol ?? '—'}</Text>
                <ChevronDown size={14} color={COLORS.textMuted} />
              </Pressable>
              <Text style={styles.amountText}>{quote ? fmtNum(quote.out, 4) : '0.00'}</Text>
            </View>
          </Card>

          {quote && (
            <Card style={styles.quote}>
              <QuoteRow label="Route" value={`${fromToken?.symbol} → ${chain.dex.split(' ')[0]} → ${toToken?.symbol}`} />
              <QuoteRow
                label="Price impact"
                value={
                  quote.impact === null
                    ? '— (liquidity data unavailable)'
                    : `${(quote.impact.impactBps / 100).toFixed(2)}%${quote.impact.ok ? '' : ' — split required'}`
                }
              />
              <QuoteRow label="Minimum received" value={`${fmtNum(quote.minOut, 4)} ${toToken?.symbol}`} />
              <QuoteRow label="Slippage" value={`${slippage}%`} />
              <QuoteRow label="Value" value={`≈ ${fmtUsd(quote.usd)}`} />
            </Card>
          )}
        </>
      )}

      <View style={styles.spacer} />
      <Btn
        label={quote ? 'Review Swap' : 'Enter Amount'}
        variant={quote ? 'primary' : 'secondary'}
        onPress={() => void execute()}
        disabled={!quote}
      />
      <Text style={styles.quoteOnly}>Quote only — swap execution is not wired yet, so no swap is placed from this screen.</Text>
      <RiskNote />

      <NetworkSheet visible={netOpen} onClose={() => setNetOpen(false)} />

      <BottomSheet visible={slipOpen} onClose={() => setSlipOpen(false)} title="Slippage tolerance">
        <View style={styles.slipRow}>
          {['0.5', '1.5', '3.0'].map((s) => (
            <Btn key={s} label={`${s}%`} variant={slippage === s ? 'primary' : 'ghost'} onPress={() => setSlippage(s)} style={styles.slipBtn} />
          ))}
        </View>
        <Text style={styles.slipHint}>Default 1.5%. A higher tolerance helps volatile pairs fill; a lower one protects your price.</Text>
      </BottomSheet>

      <BottomSheet visible={pickSide !== null} onClose={() => setPickSide(null)} title={pickSide === 'from' ? 'You Pay' : 'You Receive'}>
        {pickList.map((t) => (
          <Pressable
            key={t.symbol}
            style={styles.pickRow}
            onPress={() => {
              if (pickSide === 'from') setFrom(t.symbol);
              else setTo(t.symbol);
              setPickSide(null);
            }}
          >
            <View style={styles.tokenAvatar}>
              <Text style={styles.tokenAvatarText}>{t.symbol.slice(0, 1)}</Text>
            </View>
            <View style={styles.pickMid}>
              <Text style={styles.pickName}>{t.symbol}</Text>
              <Text style={styles.pickSub}>{t.name}</Text>
            </View>
            <Text style={styles.pickBal}>{fmtNum(t.balance, 4)}</Text>
          </Pressable>
        ))}
        {pickList.length === 0 ? <Text style={styles.emptyBody}>No tokens available.</Text> : null}
      </BottomSheet>
    </ScrollView>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.qRow}>
      <Text style={styles.qLabel}>{label}</Text>
      <Text style={styles.qValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  amountText: { color: COLORS.text, flex: 1, fontSize: 20, fontWeight: '800', textAlign: 'right' },
  bal: { color: COLORS.textMuted, fontSize: 12 },
  cardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chainBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chainText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  quoteOnly: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: 'center' },
  emptyBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  emptyCard: { marginTop: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
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
  gear: { position: 'relative' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headRight: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  headSide: { width: 32 },
  inner: { padding: 12 },
  maxBtn: { backgroundColor: COLORS.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  maxText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  payCard: { marginTop: 12, padding: 12 },
  payRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  pickBal: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  pickMid: { flex: 1 },
  pickName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  pickSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  qLabel: { color: COLORS.textMuted, fontSize: 12 },
  qRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  qValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  quote: { marginTop: 12 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  slipBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -6,
    top: -6,
  },
  slipBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  slipBtn: { flex: 1, minHeight: 36 },
  slipHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  slipRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  spacer: { flex: 1, minHeight: 24 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  tokenAvatar: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  tokenAvatarText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  tokenBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tokenSymbol: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
});
