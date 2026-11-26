/** Screen 7 — Token Detail (v1): header with price + 24h pill,
 *  Balance / Value / Locked cards, chart card (5m/15m/1h/4h/1d, EMA7 blue /
 *  EMA25 orange / Vol / RSI pills, RSI(14) strip), Safety Score, navy
 *  Create Discipline card (Bull Lock: date OR price target, auto-sell to the
 *  chain's exit stablecoin, profit ladder, trailing stop, no-early-break),
 *  Contract Info / Orderbook tabs, Price Performance, Market Data, Trading
 *  Activity, Your Holdings, Contract. Everything is LIVE: the holding comes
 *  from the store, the price from useLivePrice, market data + candles from
 *  DexScreener/GeckoTerminal. Anything unavailable shows "—", never an
 *  invented value. */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Bell, ChevronLeft, Lock, Moon, RefreshCw, Star } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import {
  computeSafetyScore,
  fetchCandles,
  fetchTokenMarketData,
  indicatorsFromCandles,
  useLivePrice,
  type Candle,
  type TokenMarketData,
} from '../../lib/prices';
import { getChain } from '../../lib/chains';
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { Btn, Card, Chip, EmptyState, ProgressBar, RiskNote, SectionTitle } from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';

type Tf = '5m' | '15m' | '1h' | '4h' | '1d';
const TFS: Tf[] = ['5m', '15m', '1h', '4h', '1d'];
const DURATIONS = [
  { label: '1 Month', days: 30 },
  { label: '5 Months', days: 150 },
  { label: '1 Year', days: 365 },
  { label: 'Custom', days: 0 },
];
const TARGETS = [2, 3, 5, 10];

const priceText = (p: number | null) => (p === null ? '—' : fmtPrice(p));
const pctText = (v: number | null) => (v === null ? '—' : fmtPct(v));

export default function TokenDetail() {
  const { symbol, address: addressParam, chainId: chainIdParam } = useLocalSearchParams<{
    symbol: string;
    address?: string;
    chainId?: string;
  }>();
  const { tokens, locks, chain: activeChain } = useApp();
  const sym = symbol ?? '';
  const storeToken = tokens.find((t) => t.symbol.toLowerCase() === sym.toLowerCase());
  const chainId = storeToken?.chainId ?? chainIdParam ?? activeChain.id;
  const address = storeToken?.address || addressParam || '';
  const live = useLivePrice(sym, {
    chainId,
    address: address || undefined,
    coingeckoId: storeToken?.coingeckoId,
  });

  // Live market data (DexScreener, GeckoTerminal fallback) for the token's
  // contract address. Native assets have no contract address — market
  // data stays null and the page shows "—" for those rows.
  const [market, setMarket] = useState<TokenMarketData | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMarket(null);
    if (!address) return;
    void fetchTokenMarketData(chainId, address).then((d) => {
      if (!cancelled) setMarket(d);
    });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  // Real candles for the chart + indicators, from the token's pair.
  const [candles, setCandles] = useState<Candle[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCandles([]);
    if (!market?.pairAddress) return;
    void fetchCandles(chainId, market.pairAddress, 'day', 100).then((c) => {
      if (!cancelled) setCandles(c);
    });
    return () => {
      cancelled = true;
    };
  }, [market?.pairAddress, chainId]);

  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const indicators = useMemo(() => indicatorsFromCandles(candles), [candles]);
  const rsi = indicators.rsi14;

  const price = live.price ?? market?.priceUsd ?? storeToken?.priceUsd ?? null;
  const change24h = live.change24h ?? market?.change24h ?? null;
  const change1h = market?.change1h ?? null;
  const change7d = market?.change7d ?? null; // DexScreener latest API does not return 7d change
  const safety = useMemo(() => (market ? computeSafetyScore(market) : null), [market]);
  const balance = storeToken?.balance ?? 0;
  const locked = storeToken?.locked ?? 0;
  const name = storeToken?.name ?? market?.name ?? sym;
  const up = (change24h ?? 0) >= 0;
  const buyPressure = market?.buyPressure ?? null;
  const totalTxns = (market?.buys24h ?? 0) + (market?.sells24h ?? 0);
  const activeLock = locks.find(
    (l) => l.tokenSymbol === sym && (l.status === 'active' || l.status === 'partially-sold'),
  );
  const tokenChain = getChain(chainId);

  const [tf, setTf] = useState<Tf>('15m');
  const [showIndicators, setShowIndicators] = useState(true);
  const [tab, setTab] = useState<'contract' | 'orderbook'>('contract');
  const [watched, setWatched] = useState(false);
  const [alertOn, setAlertOn] = useState(false);

  // --- Create Discipline (Bull Lock) state ---
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState(30);
  const [customDays, setCustomDays] = useState('60');
  const [unlockMode, setUnlockMode] = useState<'date' | 'price'>('date');
  const [target, setTarget] = useState<number | null>(3);
  const [customPrice, setCustomPrice] = useState('');
  const [ladderOn, setLadderOn] = useState(false);
  const [trailing, setTrailing] = useState<number | null>(null);
  const [noEarlyBreak, setNoEarlyBreak] = useState(true);

  const lockDays = days === 0 ? parseInt(customDays, 10) || 0 : days;
  const unlockDate = new Date(Date.now() + lockDays * 86_400_000);
  const targetPrice = target === null ? null : customPrice ? parseFloat(customPrice) || null : price !== null ? price * target : null;
  const exitLabel = tokenChain.exitStablecoinLabel;

  function reviewLock() {
    const amt = parseFloat(amount) || 0;
    if (amt <= 0 || amt > balance) {
      Alert.alert('Check the amount', `Enter an amount up to your spendable ${fmtNum(balance)} ${sym}.`);
      return;
    }
    if (lockDays <= 0) {
      Alert.alert('Choose a duration', 'Choose a lock duration.');
      return;
    }
    if (unlockMode === 'price' && (price === null || !targetPrice || targetPrice <= price)) {
      Alert.alert('Check the target', 'Set a price target above the current price (live price unavailable right now).');
      return;
    }
    router.push({
      pathname: '/vault/create',
      params: {
        symbol: sym,
        amount,
        days: String(lockDays),
        target: unlockMode === 'price' && target ? String(target) : '',
        customPrice: unlockMode === 'price' ? customPrice : '',
        ladder: ladderOn ? '1' : '0',
        trailing: trailing ? String(trailing) : '',
        breakMode: noEarlyBreak ? 'immutable' : 'penalty',
      },
    });
  }

  if (!storeToken && !addressParam) {
    return (
      <View style={styles.missing}>
        <Text style={styles.title}>Token not found</Text>
        <Text style={styles.missingBody}>This token is not in your wallet and no contract address was given.</Text>
        <Btn label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={22} color={COLORS.text} />
        </Pressable>
        <View style={styles.headToken}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{sym.slice(0, 1)}</Text>
          </View>
          <View>
            <Text style={styles.title}>{sym}</Text>
            <Text style={styles.sub}>{name}</Text>
          </View>
        </View>
        <View style={styles.headRight}>
          <Text style={styles.price}>{priceText(price)}</Text>
          <Chip label={pctText(change24h)} tone={change24h === null ? 'muted' : up ? 'mint' : 'red'} />
        </View>
        <Pressable onPress={() => Alert.alert('Live prices', 'Prices refresh automatically every minute.')} hitSlop={8}>
          <RefreshCw size={18} color={COLORS.text} />
        </Pressable>
      </View>

      <View style={styles.statCards}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Balance</Text>
          <Text style={styles.statValue}>{fmtNum(balance, 4)} {sym}</Text>
          <Text style={styles.statSub}>{fmtUsd(balance * (price ?? 0))}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Value</Text>
          <Text style={styles.statValue}>{fmtUsd(balance * (price ?? 0))}</Text>
          <Text style={styles.statSub}>{priceText(price)} / {sym}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Locked</Text>
          <Text style={styles.statValue}>{locked > 0 ? fmtNum(locked, 4) : '—'}</Text>
          <Text style={styles.statSub}>{locked > 0 ? 'In vault' : 'None'}</Text>
        </View>
      </View>

      <Card style={styles.chartCard}>
        <View style={styles.chartHead}>
          <View style={styles.moonBtn}>
            <Moon size={16} color={COLORS.text} />
          </View>
          <View style={styles.tfs}>
            {TFS.map((t) => (
              <Pressable key={t} onPress={() => setTf(t)} style={[styles.tf, tf === t && styles.tfOn]}>
                <Text style={[styles.tfText, tf === t && styles.tfTextOn]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.indBtn} onPress={() => setShowIndicators((v) => !v)}>
            <Text style={styles.indText}>Indicators</Text>
          </Pressable>
        </View>
        {showIndicators && (
          <View style={styles.pills}>
            <Pill color={COLORS.blue} label={`EMA7 ${indicators.ema7 === null ? '—' : fmtPrice(indicators.ema7)}`} />
            <Pill color={COLORS.amber} label={`EMA25 ${indicators.ema25 === null ? '—' : fmtPrice(indicators.ema25)}`} />
            <Pill color={COLORS.textMuted} label="Vol" />
            <Pill color={COLORS.mint} label="RSI" />
          </View>
        )}
        <PriceChart series={closes} showEma={showIndicators} />
        <View style={styles.rsiRow}>
          <Text style={styles.rsiLabel}>RSI(14)</Text>
          <Text style={styles.rsiValue}>
            {rsi === null ? '—' : `${rsi.toFixed(0)} — ${rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'}`}
          </Text>
        </View>
        <View style={styles.chartFoot}>
          <Text style={styles.footPrice}>{priceText(price)}</Text>
          <Chip label={pctText(change24h)} tone={change24h === null ? 'muted' : up ? 'mint' : 'red'} />
          <Text style={styles.zoom}>Pinch to zoom</Text>
        </View>
        <Text style={styles.liveNote}>
          {live.source === 'unavailable' ? 'Price may be delayed — live feed unavailable right now' : `Live price · ${live.source}`}
        </Text>
      </Card>

      <SectionTitle title="Safety Score" />
      <Card>
        {safety === null || safety.score === null ? (
          <>
            <Text style={styles.safetyNum}>—</Text>
            <Text style={styles.safetyNote}>{safety?.label ?? 'Insufficient data'} — safety inputs are unavailable for this token right now.</Text>
          </>
        ) : (
          <>
            <View style={styles.safetyTop}>
              <Text style={styles.safetyNum}>{safety.score}</Text>
              <View style={styles.safetyRight}>
                <Chip
                  label={safety.label}
                  tone={safety.score >= 80 ? 'mint' : safety.score >= 50 ? 'amber' : 'red'}
                />
                <ProgressBar value={safety.score / 100} />
              </View>
            </View>
            {safety.inputs.map((input) => (
              <Text key={input.name} style={styles.reason}>
                • {input.name}: {input.value}
              </Text>
            ))}
          </>
        )}
        <Text style={styles.safetyNote}>Scores are estimates from on-chain signals — not a guarantee.</Text>
      </Card>

      <Card dark style={styles.disciplineCard}>
        <View style={styles.discHead}>
          <View style={styles.discIcon}>
            <Lock size={18} color="#fff" />
          </View>
          <View>
            <Text style={styles.discTitle}>Create Discipline</Text>
            <Text style={styles.discSub}>Lock {sym} immutably on-chain</Text>
          </View>
        </View>

        <Text style={styles.discLabel}>Amount to lock</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={styles.amountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={COLORS.textOnNavyMuted}
            value={amount}
            onChangeText={setAmount}
          />
          <Text style={styles.amountSym}>{sym}</Text>
        </View>
        <Text style={styles.discHint}>Spendable: {fmtNum(balance, 4)} {sym}</Text>

        <Text style={styles.discLabel}>Lock Duration</Text>
        <View style={styles.chips}>
          {DURATIONS.map((d) => (
            <Pressable key={d.label} onPress={() => setDays(d.days)} style={[styles.chipBtn, days === d.days && styles.chipBtnOn]}>
              <Text style={[styles.chipBtnText, days === d.days && styles.chipBtnTextOn]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>
        {days === 0 && (
          <TextInput
            style={styles.darkInput}
            keyboardType="number-pad"
            placeholder="Days (e.g. 60)"
            placeholderTextColor={COLORS.textOnNavyMuted}
            value={customDays}
            onChangeText={setCustomDays}
          />
        )}
        <Text style={styles.unlockLine}>
          Unlocks {lockDays > 0 ? fmtDate(unlockDate.getTime()) : '—'} ({lockDays > 0 ? `${lockDays} days` : 'pick a duration'})
        </Text>

        <Text style={styles.discLabel}>Unlock on</Text>
        <View style={styles.chips}>
          <Pressable onPress={() => setUnlockMode('date')} style={[styles.chipBtn, unlockMode === 'date' && styles.chipBtnOn]}>
            <Text style={[styles.chipBtnText, unlockMode === 'date' && styles.chipBtnTextOn]}>Date</Text>
          </Pressable>
          <Pressable onPress={() => setUnlockMode('price')} style={[styles.chipBtn, unlockMode === 'price' && styles.chipBtnOn]}>
            <Text style={[styles.chipBtnText, unlockMode === 'price' && styles.chipBtnTextOn]}>Price target</Text>
          </Pressable>
        </View>
        {unlockMode === 'price' && (
          <>
            <View style={styles.chips}>
              {TARGETS.map((m) => (
                <Pressable key={m} onPress={() => { setTarget(m); setCustomPrice(''); }} style={[styles.chipBtn, target === m && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, target === m && styles.chipBtnTextOn]}>{m}x</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.darkInput}
              keyboardType="decimal-pad"
              placeholder={`Custom target price (default ${target && price !== null ? fmtPrice(price * target) : '—'})`}
              placeholderTextColor={COLORS.textOnNavyMuted}
              value={customPrice}
              onChangeText={setCustomPrice}
            />
            <Text style={styles.discHint}>
              Entry {priceText(price)} · Target {targetPrice ? fmtPrice(targetPrice) : '—'} · {exitLabel} on hit
            </Text>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Profit ladder — sell 25% at 2x, 3x, 5x, 10x</Text>
              <Switch value={ladderOn} onValueChange={setLadderOn} trackColor={{ true: COLORS.mint }} />
            </View>
            <Text style={styles.discLabel}>Trailing stop (after first target hit)</Text>
            <View style={styles.chips}>
              {[
                { label: 'Off', v: null },
                { label: '10%', v: 1000 },
                { label: '15%', v: 1500 },
                { label: '20%', v: 2000 },
              ].map((o) => (
                <Pressable key={o.label} onPress={() => setTrailing(o.v)} style={[styles.chipBtn, trailing === o.v && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, trailing === o.v && styles.chipBtnTextOn]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>No early break — immutable until maturity</Text>
          <Switch value={noEarlyBreak} onValueChange={setNoEarlyBreak} trackColor={{ true: COLORS.mint }} />
        </View>
        <Btn label="Review & Lock" variant="secondary" onPress={reviewLock} style={styles.reviewBtn} />
      </Card>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setTab('contract')} style={[styles.tabBtn, tab === 'contract' && styles.tabBtnOn]}>
          <Text style={[styles.tabBtnText, tab === 'contract' && styles.tabBtnTextOn]}>Contract Info</Text>
        </Pressable>
        <Pressable onPress={() => setTab('orderbook')} style={[styles.tabBtn, tab === 'orderbook' && styles.tabBtnOn]}>
          <Text style={[styles.tabBtnText, tab === 'orderbook' && styles.tabBtnTextOn]}>Orderbook</Text>
        </Pressable>
      </View>

      {tab === 'orderbook' ? (
        <EmptyState title="No orderbook yet" body="Orderbook data is not available for this pair yet." />
      ) : (
        <>
          <SectionTitle title="Price Performance" />
          <Card>
            <DataRow label="1h" value={pctText(change1h)} tone={change1h === null ? undefined : change1h >= 0 ? 'mint' : 'red'} />
            <DataRow label="24h" value={pctText(change24h)} tone={change24h === null ? undefined : change24h >= 0 ? 'mint' : 'red'} />
            <DataRow label="7d" value={pctText(change7d)} tone={change7d === null ? undefined : change7d >= 0 ? 'mint' : 'red'} />
          </Card>

          <SectionTitle title="Market Data" />
          <Card>
            <DataRow label="Price" value={priceText(price)} />
            <DataRow label="Market Cap" value={market?.marketCap === null || market?.marketCap === undefined ? '—' : fmtUsd(market.marketCap, 0)} />
            <DataRow label="Total Supply" value="—" />
            <DataRow label="Liquidity" value={market?.liquidityUsd === null || market?.liquidityUsd === undefined ? '—' : fmtUsd(market.liquidityUsd, 0)} />
            <DataRow label="Volume 24h" value={market?.volume24h === null || market?.volume24h === undefined ? '—' : fmtUsd(market.volume24h, 0)} />
            <DataRow label="Volume 1h" value="—" />
            <DataRow label="RSI (14)" value={rsi === null ? '—' : `${rsi.toFixed(0)}`} />
          </Card>

          <SectionTitle title="Trading Activity (24h)" />
          <Card>
            <DataRow label="Buys" value={market?.buys24h === null || market?.buys24h === undefined ? '—' : fmtNum(market.buys24h, 0)} tone="mint" />
            <DataRow label="Sells" value={market?.sells24h === null || market?.sells24h === undefined ? '—' : fmtNum(market.sells24h, 0)} tone="red" />
            <DataRow label="Total Txns" value={totalTxns > 0 ? fmtNum(totalTxns, 0) : '—'} />
            <DataRow label="Buy Pressure" value={buyPressure === null ? '—' : `${Math.round(buyPressure * 100)}%`} tone={buyPressure === null ? undefined : buyPressure >= 0.5 ? 'mint' : 'red'} />
          </Card>

          <SectionTitle title="Your Holdings" />
          <Card>
            <DataRow label="Available" value={`${fmtNum(balance, 4)} ${sym}`} />
            <DataRow label="Value" value={fmtUsd(balance * (price ?? 0))} />
            <DataRow label="Vault Locked" value={locked > 0 ? fmtNum(locked, 4) : '—'} />
            <DataRow
              label="Maturity"
              value={activeLock ? fmtDate(activeLock.unlockTime) : 'No Active Lock'}
            />
            {address ? (
              <Pressable onPress={() => Clipboard.setStringAsync(address)}>
                <Text style={styles.addr}>Contract: {address.slice(0, 10)}…{address.slice(-6)} — tap to copy</Text>
              </Pressable>
            ) : (
              <Text style={styles.addr}>Contract: — (native asset)</Text>
            )}
          </Card>

          <SectionTitle title="Contract" />
          <Card>
            <DataRow label="Address" value={address ? `${address.slice(0, 10)}…${address.slice(-6)}` : '—'} />
            <DataRow label="Pair" value={market?.pairAddress ? `${market.pairAddress.slice(0, 10)}…${market.pairAddress.slice(-6)}` : '—'} />
            <DataRow label="DEX" value={tokenChain.dex.split(' ')[0]} />
            <DataRow label="Chain" value={chainId} />
          </Card>
        </>
      )}

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
          <Bell size={16} color={alertOn ? COLORS.mintDark : COLORS.textMuted} />
          <Text style={styles.iconLabel}>{alertOn ? 'Alert on' : 'Price alert'}</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => setWatched((v) => !v)}>
          <Star size={16} color={watched ? COLORS.navy : COLORS.textMuted} />
          <Text style={styles.iconLabel}>{watched ? 'Watching' : 'Watchlist'}</Text>
        </Pressable>
      </View>
      <RiskNote />
    </ScrollView>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function DataRow({ label, value, tone }: { label: string; value: string; tone?: 'mint' | 'red' }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={[styles.dataValue, tone === 'mint' && { color: COLORS.mintDark }, tone === 'red' && { color: COLORS.red }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  addr: { color: COLORS.blue, fontSize: 12, marginTop: 8 },
  amountInput: { color: '#fff', flex: 1, fontSize: 16, fontWeight: '800' },
  amountRow: {
    alignItems: 'center',
    backgroundColor: COLORS.navySoft,
    borderRadius: 12,
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  amountSym: { color: '#fff', fontSize: 14, fontWeight: '700' },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  chartCard: { marginTop: 12 },
  chartFoot: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  chartHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  chipBtn: {
    borderColor: COLORS.navySoft,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipBtnOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chipBtnTextOn: { color: COLORS.navy },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  darkInput: {
    backgroundColor: COLORS.navySoft,
    borderRadius: 12,
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
    padding: 10,
  },
  dataLabel: { color: COLORS.textMuted, fontSize: 12 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  dataValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  discHead: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  discHint: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 6 },
  discIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navySoft,
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  discLabel: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 14 },
  discSub: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 2 },
  discTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disciplineCard: { marginTop: 12, padding: 14 },
  footPrice: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  head: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  headRight: { alignItems: 'flex-end', gap: 2 },
  headToken: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8 },
  iconBtn: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  iconLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  iconRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', marginTop: 14 },
  indBtn: { borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  indText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  inner: { padding: 12 },
  liveNote: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  missing: { backgroundColor: COLORS.bg, flex: 1, gap: 12, justifyContent: 'center', padding: 16 },
  missingBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  moonBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillDot: { borderRadius: 999, height: 8, width: 8 },
  pillText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  pills: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 10 },
  price: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  reason: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  reviewBtn: { backgroundColor: '#fff', marginTop: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  rsiLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  rsiRow: { alignItems: 'center', borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8 },
  rsiValue: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  safetyNote: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  safetyNum: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  safetyRight: { flex: 1, gap: 8 },
  safetyTop: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  statCard: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  statCards: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  statSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  statValue: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 2 },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  tabBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
  },
  tabBtnOn: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  tabBtnText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  tabBtnTextOn: { color: '#fff' },
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tf: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  tfOn: { backgroundColor: COLORS.bgMuted },
  tfText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  tfTextOn: { color: COLORS.text },
  tfs: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  toggleLabel: { color: '#fff', flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: COLORS.navySoft,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  unlockLine: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 8 },
  zoom: { color: COLORS.textMuted, fontSize: 11, marginLeft: 'auto' },
});
