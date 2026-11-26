/** Screen 7 — Token Detail: chart EMA7/EMA25/Vol/RSI, safety score, market data, trading activity. */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Bell, Lock, Send, Star } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { demoChartSeries, demoToken } from '../../lib/demoData';
import { useLivePrice } from '../../lib/prices';
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { Btn, Card, Chip, DemoBadge, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';

type Range = '1h' | '24h' | '7d';

export default function TokenDetail() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const token = demoToken(symbol ?? 'BNB');
  const live = useLivePrice(token.symbol);
  const [range, setRange] = useState<Range>('24h');
  const [watched, setWatched] = useState(false);
  const [alertOn, setAlertOn] = useState(false);
  const series = useMemo(() => demoChartSeries(token.symbol), [token.symbol]);
  const change = range === '1h' ? token.change1h : range === '7d' ? token.change7d : token.change24h;
  const up = change >= 0;
  const buyPressure = token.buys24h + token.sells24h > 0
    ? Math.round((token.buys24h / (token.buys24h + token.sells24h)) * 100)
    : 50;
  const rsi = 58; // demo RSI derived from series momentum in production
  const activeLock = useApp().locks.find((l) => l.tokenSymbol === token.symbol && (l.status === 'active' || l.status === 'partially-sold'));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>{token.symbol}</Text>
          <Text style={styles.sub}>{token.name} · {token.chainId.toUpperCase()}</Text>
        </View>
        <DemoBadge />
      </View>

      <Text style={styles.price}>{fmtPrice(live.price)}</Text>
      <Text style={[styles.change, { color: up ? COLORS.mintDark : COLORS.red }]}>
        {fmtPct(change)} ({range}) {live.source === 'live' ? '· live' : '· demo price'}
      </Text>

      <View style={styles.ranges}>
        {(['1h', '24h', '7d'] as Range[]).map((r) => (
          <Btn key={r} label={r} variant={range === r ? 'primary' : 'ghost'} onPress={() => setRange(r)} style={styles.rangeBtn} />
        ))}
      </View>

      <PriceChart series={series} />
      <View style={styles.legend}>
        <Legend color={COLORS.mint} label="Price" />
        <Legend color={COLORS.amber} label="EMA7" />
        <Legend color={COLORS.blue} label="EMA25" />
        <Legend color={COLORS.border} label="Volume" />
      </View>

      <SectionTitle title="Market Data" />
      <Card>
        <DataRow label="Market cap" value={fmtUsd(token.marketCap, 0)} />
        <DataRow label="Liquidity" value={fmtUsd(token.liquidity, 0)} />
        <DataRow label="24h volume" value={fmtUsd(token.volume24h, 0)} />
        <DataRow label="Total supply" value={fmtNum(token.totalSupply, 0)} />
        <DataRow label="RSI (14)" value={`${rsi} — ${rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'}`} />
      </Card>

      <SectionTitle title="Trading Activity (24h)" />
      <Card>
        <DataRow label="Buys" value={fmtNum(token.buys24h, 0)} />
        <DataRow label="Sells" value={fmtNum(token.sells24h, 0)} />
        <View style={styles.pressure}>
          <Text style={styles.pressureLabel}>Buy pressure {buyPressure}%</Text>
          <ProgressBar value={buyPressure / 100} color={buyPressure >= 50 ? COLORS.mint : COLORS.red} />
        </View>
      </Card>

      <SectionTitle title="Safety Score" />
      <Card>
        <View style={styles.safetyTop}>
          <Text style={styles.safetyNum}>{token.safetyScore}</Text>
          <View style={styles.safetyRight}>
            <Chip label={token.safetyScore >= 80 ? 'Low risk' : token.safetyScore >= 60 ? 'Medium risk' : 'High risk'} tone={token.safetyScore >= 80 ? 'mint' : token.safetyScore >= 60 ? 'amber' : 'red'} />
            <ProgressBar value={token.safetyScore / 100} />
          </View>
        </View>
        {token.safetyReasons.map((r) => (
          <Text key={r} style={styles.reason}>• {r}</Text>
        ))}
      </Card>

      <SectionTitle title="Your Holdings" />
      <Card>
        <DataRow label="Available" value={`${fmtNum(token.balance)} ${token.symbol} (${fmtUsd(token.balance * token.price)})`} />
        <DataRow label="Vault locked" value={`${fmtNum(token.locked)} ${token.symbol} (${fmtUsd(token.locked * token.price)})`} />
        {activeLock && (
          <DataRow
            label="Lock status"
            value={`${activeLock.targetMultiple ? `${activeLock.targetMultiple}x target` : 'Date lock'} · ${new Date(activeLock.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          />
        )}
        <Pressable onPress={() => Clipboard.setStringAsync(token.address)}>
          <Text style={styles.addr}>Contract: {token.address.slice(0, 10)}…{token.address.slice(-6)} — tap to copy</Text>
        </Pressable>
      </Card>

      <View style={styles.actions}>
        <Btn
          label={activeLock ? 'View Lock' : 'Lock'}
          variant="mint"
          onPress={() => (activeLock ? router.push(`/vault/${activeLock.id}`) : router.push('/vault/create'))}
          style={styles.actionBtn}
        />
        <Btn label="Send" onPress={() => router.push('/send')} style={styles.actionBtn} />
        <Btn label="Swap" variant="ghost" onPress={() => router.push('/(tabs)/swap')} style={styles.actionBtn} />
      </View>
      <View style={styles.iconRow}>
        <Pressable style={styles.iconBtn} onPress={() => setAlertOn((v) => !v)}>
          <Bell size={18} color={alertOn ? COLORS.mintDark : COLORS.textMuted} />
          <Text style={styles.iconLabel}>{alertOn ? 'Alert on' : 'Price alert'}</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setWatched((v) => !v)}>
          <Star size={18} color={watched ? COLORS.gold : COLORS.textMuted} />
          <Text style={styles.iconLabel}>{watched ? 'Watching' : 'Watchlist'}</Text>
        </Pressable>
      </View>
      <RiskNote />
    </ScrollView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  addr: { color: COLORS.blue, fontSize: 12, marginTop: 10 },
  change: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  dataLabel: { color: COLORS.textMuted, fontSize: 13 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  dataValue: { color: COLORS.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  head: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  iconBtn: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  iconLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  iconRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', marginTop: 16 },
  inner: { padding: 20 },
  legend: { flexDirection: 'row', gap: 14, justifyContent: 'center', marginTop: 8 },
  legendDot: { borderRadius: 999, height: 10, width: 10 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendText: { color: COLORS.textMuted, fontSize: 12 },
  pressure: { marginTop: 8 },
  pressureLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  price: { color: COLORS.text, fontSize: 30, fontWeight: '800', marginTop: 14 },
  rangeBtn: { minHeight: 36, paddingHorizontal: 14 },
  ranges: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  reason: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  safetyNum: { color: COLORS.text, fontSize: 34, fontWeight: '800' },
  safetyRight: { flex: 1, gap: 8 },
  safetyTop: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  sub: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
});
