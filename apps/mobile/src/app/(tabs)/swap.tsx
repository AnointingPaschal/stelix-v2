/** Screen 10 — Swap: aggregated quote, route, impact, minimum received, slippage 1.5% default. */
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowDownUp } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, fmtUsd } from '../../lib/format';
import { minimumReceive, priceImpactPieces } from '../../lib/vault';
import { VAULT_DEFAULTS } from '../../lib/chains';
import { Btn, Card, Chip, DemoBadge, RiskNote, SectionTitle } from '../../components/ui';

export default function Swap() {
  const { tokens, chain, addTx } = useApp();
  const spendable = tokens.filter((t) => !t.isSpam && t.balance > 0);
  const [from, setFrom] = useState(spendable[0]?.symbol ?? 'BNB');
  const [to, setTo] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1.5');
  const [done, setDone] = useState(false);

  const fromToken = tokens.find((t) => t.symbol === from) ?? spendable[0];
  const toToken = tokens.find((t) => t.symbol === to) ?? tokens[2];
  const amt = parseFloat(amount) || 0;
  const quote = useMemo(() => {
    if (!fromToken || !toToken || amt <= 0) return null;
    const usd = amt * fromToken.price;
    const out = usd / toToken.price;
    const impact = priceImpactPieces(usd, toToken.liquidity, VAULT_DEFAULTS.maxPriceImpactBps);
    return { usd, out, minOut: minimumReceive(out, parseFloat(slippage) * 100 || 150), impact };
  }, [amt, fromToken, toToken, slippage]);

  function flip() {
    setFrom(to);
    setTo(from);
    setAmount('');
    setDone(false);
  }

  function execute() {
    if (!quote || !fromToken) return;
    if (amt > fromToken.balance) {
      Alert.alert('Insufficient spendable balance', 'Locked funds cannot be swapped. Only your spendable balance is available.');
      return;
    }
    if (!quote.impact.ok) {
      Alert.alert(
        'High price impact',
        `This swap would move the price ${((quote.impact.impactBps / 100)).toFixed(1)}%. The guard splits it into ${quote.impact.pieces} smaller pieces instead of dumping. Continue with the split?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue (split)', onPress: confirm },
        ],
      );
      return;
    }
    confirm();
  }

  function confirm() {
    if (!quote || !fromToken || !toToken) return;
    addTx({
      id: `tx-${Date.now()}`,
      kind: 'swap',
      token: toToken.symbol,
      amount: quote.out,
      usd: quote.usd,
      note: `Swapped ${fmtNum(amt)} ${fromToken.symbol} → ${fmtNum(quote.out)} ${toToken.symbol}`,
      at: Date.now(),
      status: 'confirmed',
    });
    setDone(true);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Swap</Text>
        <DemoBadge />
      </View>
      <Text style={styles.chain}>{chain.name} · {chain.dex}</Text>

      <SectionTitle title="You Pay" />
      <Card>
        <View style={styles.row}>
          <TextInput
            style={styles.amountInput}
            keyboardType="decimal-pad"
            placeholder="0.0"
            value={amount}
            onChangeText={(v) => { setAmount(v); setDone(false); }}
          />
          <Chip label={fromToken?.symbol ?? ''} tone="navy" />
        </View>
        <Text style={styles.balance}>
          Spendable: {fmtNum(fromToken?.balance ?? 0)} {fromToken?.symbol}
          {fromToken && fromToken.locked > 0 ? ` · ${fmtNum(fromToken.locked)} locked (unavailable)` : ''}
        </Text>
        <View style={styles.tokenPills}>
          {spendable.map((t) => (
            <Btn key={t.symbol} label={t.symbol} variant={from === t.symbol ? 'primary' : 'ghost'} onPress={() => setFrom(t.symbol)} style={styles.pill} />
          ))}
        </View>
      </Card>

      <View style={styles.flipWrap}>
        <Pressable onPress={flip} style={styles.flipBtn}>
          <ArrowDownUp size={20} color={COLORS.navy} />
        </Pressable>
      </View>

      <SectionTitle title="You Receive" />
      <Card>
        <View style={styles.row}>
          <Text style={styles.amountText}>{quote ? fmtNum(quote.out, 4) : '0.0'}</Text>
          <Chip label={toToken?.symbol ?? ''} tone="mint" />
        </View>
        <Text style={styles.balance}>{quote ? `≈ ${fmtUsd(quote.usd)}` : 'Enter an amount for a live quote'}</Text>
        <View style={styles.tokenPills}>
          {spendable.map((t) => (
            <Btn key={t.symbol} label={t.symbol} variant={to === t.symbol ? 'mint' : 'ghost'} onPress={() => setTo(t.symbol)} style={styles.pill} />
          ))}
        </View>
      </Card>

      {quote && (
        <Card style={styles.quote}>
          <QuoteRow label="Route" value={`${fromToken?.symbol} → ${chain.dex.split(' ')[0]} → ${toToken?.symbol}`} />
          <QuoteRow label="Price impact" value={`${(quote.impact.impactBps / 100).toFixed(2)}%${quote.impact.ok ? '' : ' — split required'}`} />
          <QuoteRow label="Minimum received" value={`${fmtNum(quote.minOut, 4)} ${toToken?.symbol}`} />
          <QuoteRow label="Network fee (est.)" value="≈ $0.42" />
          <View style={styles.slipRow}>
            <Text style={styles.slipLabel}>Slippage tolerance</Text>
            <View style={styles.slipBtns}>
              {['0.5', '1.5', '3.0'].map((s) => (
                <Btn key={s} label={`${s}%`} variant={slippage === s ? 'primary' : 'ghost'} onPress={() => setSlippage(s)} style={styles.slipBtn} />
              ))}
            </View>
          </View>
        </Card>
      )}

      {done ? (
        <Card style={styles.done}>
          <Text style={styles.doneTitle}>Swap confirmed (DEMO)</Text>
          <Text style={styles.doneBody}>
            {quote ? `${fmtNum(quote.out, 4)} ${toToken?.symbol} received.` : ''} Track it in History with its explorer link.
          </Text>
        </Card>
      ) : (
        <Btn label="Review Swap" onPress={execute} disabled={!quote} />
      )}
      <RiskNote />
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
  amountInput: { flex: 1, fontSize: 26, fontWeight: '800' },
  amountText: { color: COLORS.text, flex: 1, fontSize: 26, fontWeight: '800' },
  balance: { color: COLORS.textMuted, fontSize: 13, marginTop: 8 },
  chain: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  done: { backgroundColor: COLORS.mintSoft, marginTop: 16 },
  doneBody: { color: COLORS.mintDark, fontSize: 14, lineHeight: 20, marginTop: 6 },
  doneTitle: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  flipWrap: { alignItems: 'center', marginVertical: -6, zIndex: 1 },
  flipBtn: { alignItems: 'center', backgroundColor: COLORS.bgMuted, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  pill: { minHeight: 36, paddingHorizontal: 12 },
  qLabel: { color: COLORS.textMuted, fontSize: 13 },
  qRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  qValue: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  quote: { marginTop: 16 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  slipBtn: { minHeight: 36, paddingHorizontal: 10 },
  slipBtns: { flexDirection: 'row', gap: 6 },
  slipLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  slipRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  tokenPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
