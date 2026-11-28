/**
 * Trade screen — Spot + Perpetuals on Hyperliquid.
 *
 * Two tabs share a market picker, the reusable PriceChart (Hyperliquid
 * candles) and a funding card. Trading uses Hyperliquid margin only.
 * Testnet is the default; mainnet is an explicit flip and is badged
 * everywhere as real money. Deposits are honest: mainnet deposits come
 * from Arbitrum (USDC on Arbitrum + a little ETH for gas, sent to the
 * bridge — no one-tap cross-chain deposit is faked here); testnet links
 * to the mock-USDC faucet. Withdrawals go back to Arbitrum.
 *
 * Every order, close and withdrawal is confirmed in TradeConfirmSheet,
 * which owns all signing UI. This screen never asks the user to
 * authenticate itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, Search } from 'lucide-react-native';
import type { Signer } from 'ethers';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtPrice, fmtUsd } from '../../lib/format';
import {
  HyperliquidClient,
  MAX_LEVERAGE,
  type CandleInterval,
  type HyperliquidEnv,
  type HyperliquidSigner,
  type OpenOrder,
  type PerpAccountState,
  type PerpMarket,
  type PerpPosition,
  type SpotBalance,
  type SpotMarket,
} from '../../lib/hyperliquid';
import {
  buildClosePositionSummary,
  buildPerpOrderSummary,
  buildSpotOrderSummary,
  buildWithdrawSummary,
  clampLeverage,
  depositExplainer,
  DEFAULT_TRADE_ENV,
  envBadge,
  estimateLiquidationPrice,
  filterTradeMarkets,
  parseTradeAmount,
  sizeFromUsdc,
  spotTotal,
  usdcFromSize,
  type OrderSummary,
} from '../../lib/trade';
import { PriceChart } from '../../components/PriceChart';
import { BottomSheet, Btn, Card, Chip, EmptyState } from '../../components/ui';
import { AppHeader } from '../../components/AppShell';
import { TradeConfirmSheet } from '../../components/TradeConfirmSheet';

type TradeTab = 'spot' | 'perp';
type OrderSide = 'buy' | 'sell';
type PerpSide = 'long' | 'short';
type OrderType = 'market' | 'limit';
type AmountMode = 'usdc' | 'coin';

interface HistoryEntry {
  id: string;
  at: number;
  title: string;
  detail: string;
}

interface PendingConfirm {
  summary: OrderSummary;
  confirmLabel: string;
  onConfirm: (signer: Signer) => Promise<unknown>;
  onDone: (result: unknown) => void;
}

const CHART_INTERVAL: CandleInterval = '1h';
const CHART_DAYS = 7;

function asHyperliquidSigner(signer: Signer): HyperliquidSigner {
  return signer as unknown as HyperliquidSigner;
}

export default function Trade() {
  const { address } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [env, setEnv] = useState<HyperliquidEnv>(DEFAULT_TRADE_ENV);
  const [tab, setTab] = useState<TradeTab>('spot');

  const client = useMemo(() => new HyperliquidClient(env), [env]);
  useEffect(() => () => client.disconnect(), [client]);
  const depositInfo = useMemo(() => client.getDepositInfo(), [client]);

  // --- markets -------------------------------------------------------------
  const [perpMarkets, setPerpMarkets] = useState<PerpMarket[]>([]);
  const [spotMarkets, setSpotMarkets] = useState<SpotMarket[]>([]);
  const [marketsError, setMarketsError] = useState('');
  const [perpCoin, setPerpCoin] = useState('BTC');
  const [spotPair, setSpotPair] = useState('PURR/USDC');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const marketNames = useMemo(
    () =>
      tab === 'perp'
        ? perpMarkets.filter((m) => !m.isDelisted).map((m) => m.name)
        : spotMarkets.map((m) => m.name),
    [tab, perpMarkets, spotMarkets],
  );
  const selectedMarket = tab === 'perp' ? perpCoin : spotPair;
  const selectedPerp = useMemo(
    () => perpMarkets.find((m) => m.name === perpCoin),
    [perpMarkets, perpCoin],
  );
  const chartCoin = tab === 'perp' ? perpCoin : spotPair.split('/')[0];

  useEffect(() => {
    let cancelled = false;
    void Promise.all([client.getPerpMarkets(), client.getSpotMeta()])
      .then(([perps, spot]) => {
        if (cancelled) return;
        setMarketsError('');
        setPerpMarkets(perps);
        setSpotMarkets(spot.markets);
        if (!perps.some((m) => m.name === perpCoin) && perps.length > 0) {
          setPerpCoin(perps.find((m) => m.name === 'BTC')?.name ?? perps[0].name);
        }
        if (!spot.markets.some((m) => m.name === spotPair) && spot.markets.length > 0) {
          setSpotPair(spot.markets[0].name);
        }
      })
      .catch((e) => {
        if (!cancelled) setMarketsError(e instanceof Error ? e.message : 'Could not load markets.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // --- live price + candles -------------------------------------------------
  const [mids, setMids] = useState<Record<string, number>>({});
  const [candles, setCandles] = useState<{ time: number; open: number; high: number; low: number; close: number; volume: number; trades: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void client
      .getAllMids()
      .then((m) => {
        if (!cancelled) setMids(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, selectedMarket]);

  useEffect(() => {
    let cancelled = false;
    const end = Date.now();
    const start = end - CHART_DAYS * 24 * 60 * 60 * 1000;
    void client
      .getCandles(chartCoin, CHART_INTERVAL, start, end)
      .then((c) => {
        if (!cancelled) {
          setChartError('');
          setCandles(c);
        }
      })
      .catch((e) => {
        if (!cancelled) setChartError(e instanceof Error ? e.message : 'Chart unavailable.');
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, chartCoin]);

  const midPrice = mids[chartCoin] ?? (candles.length > 0 ? candles[candles.length - 1].close : null);

  // --- account: balances, positions, open orders ---------------------------
  const [perpAccount, setPerpAccount] = useState<PerpAccountState | null>(null);
  const [spotBalances, setSpotBalances] = useState<SpotBalance[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);

  const refreshAccount = useCallback(async () => {
    if (!address) return;
    setAccountLoading(true);
    try {
      const [perp, spot, orders] = await Promise.all([
        client.getPerpAccountState(address),
        client.getSpotBalances(address),
        client.getOpenOrders(address),
      ]);
      setPerpAccount(perp);
      setSpotBalances(spot);
      setOpenOrders(orders);
      setAccountError('');
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : 'Could not load your trading account.');
    } finally {
      setAccountLoading(false);
    }
  }, [address, client]);

  useEffect(() => {
    // Defer the fetch past the effect body so the loading state update
    // does not run synchronously inside the effect.
    queueMicrotask(() => void refreshAccount());
  }, [refreshAccount]);

  const usdcSpot = useMemo(
    () => spotBalances.find((b) => b.coin === 'USDC')?.available ?? 0,
    [spotBalances],
  );
  const tradingBalance = (perpAccount?.withdrawable ?? 0) + usdcSpot;
  const positions: PerpPosition[] = perpAccount?.positions ?? [];
  const spotOpenOrders = openOrders.filter((o) => spotMarkets.some((m) => m.name.startsWith(`${o.coin}/`)));
  const perpOpenOrders = openOrders.filter((o) => perpMarkets.some((m) => m.name === o.coin));
  const shownOpenOrders = tab === 'perp' ? perpOpenOrders : spotOpenOrders;

  // --- order forms -----------------------------------------------------------
  const [side, setSide] = useState<OrderSide>('buy');
  const [perpSide, setPerpSide] = useState<PerpSide>('long');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [amountMode, setAmountMode] = useState<AmountMode>('usdc');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverageInput, setLeverageInput] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [formError, setFormError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const leverage = clampLeverage(parseTradeAmount(leverageInput) || 1, selectedPerp?.maxLeverage ?? MAX_LEVERAGE);
  const execPrice = orderType === 'limit' ? parseTradeAmount(limitPrice) : (midPrice ?? 0);
  const amountNum = parseTradeAmount(amount);
  const size =
    amountMode === 'usdc' ? sizeFromUsdc(amountNum, execPrice) : amountNum;
  const total = tab === 'perp' ? usdcFromSize(size, execPrice) : spotTotal(size, execPrice);
  const estLiq =
    tab === 'perp' && execPrice > 0 ? estimateLiquidationPrice(execPrice, leverage, perpSide) : null;
  const tpNum = parseTradeAmount(takeProfit);
  const slNum = parseTradeAmount(stopLoss);

  // --- withdraw form ---------------------------------------------------------
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawTo, setWithdrawTo] = useState('');
  const [copiedBridge, setCopiedBridge] = useState(false);

  // Prefill the withdrawal destination with the wallet address once it
  // is known. Adjusted during render (the documented pattern for
  // syncing state to a value that arrives later), not in an effect.
  if (address && !withdrawTo) setWithdrawTo(address);

  // --- confirmation sheet ------------------------------------------------------
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [sheetError, setSheetError] = useState('');
  const confirmSeq = useRef(0);

  function pushHistory(title: string, detail: string) {
    confirmSeq.current += 1;
    setHistory((h) => [{ id: `${Date.now()}-${confirmSeq.current}`, at: Date.now(), title, detail }, ...h].slice(0, 30));
  }

  function reviewSpotOrder() {
    setFormError('');
    if (!address) {
      setFormError('Open your wallet first — trading needs a wallet address.');
      return;
    }
    if (amountNum <= 0) {
      setFormError('Enter an amount.');
      return;
    }
    if (execPrice <= 0) {
      setFormError(orderType === 'limit' ? 'Enter a limit price above zero.' : 'No live price yet — wait a moment and try again.');
      return;
    }
    if (size <= 0) {
      setFormError('That size is too small for this market.');
      return;
    }
    const summary = buildSpotOrderSummary({
      side,
      pair: spotPair,
      size,
      price: execPrice,
      orderType,
      env,
    });
    const isBuy = side === 'buy';
    setPending({
      summary,
      confirmLabel: side === 'buy' ? 'Buy' : 'Sell',
      onConfirm: async (signer) => {
        const hlSigner = asHyperliquidSigner(signer);
        return orderType === 'market'
          ? client.placeSpotMarketOrder(hlSigner, { pair: spotPair, isBuy, size })
          : client.placeSpotLimitOrder(hlSigner, { pair: spotPair, isBuy, size, price: execPrice });
      },
      onDone: () => {
        pushHistory(
          `${side === 'buy' ? 'Bought' : 'Sold'} ${spotPair}`,
          `${size.toLocaleString('en-US', { maximumFractionDigits: 6 })} at ${fmtUsd(execPrice)} · ${fmtUsd(total)} total`,
        );
        setAmount('');
        setLimitPrice('');
        void refreshAccount();
      },
    });
  }

  function reviewPerpOrder() {
    setFormError('');
    if (!address) {
      setFormError('Open your wallet first — trading needs a wallet address.');
      return;
    }
    if (amountNum <= 0) {
      setFormError('Enter an amount.');
      return;
    }
    if (execPrice <= 0) {
      setFormError(orderType === 'limit' ? 'Enter a limit price above zero.' : 'No live price yet — wait a moment and try again.');
      return;
    }
    if (size <= 0) {
      setFormError('That size is too small for this market.');
      return;
    }
    if (tpNum > 0 && ((perpSide === 'long' && tpNum <= execPrice) || (perpSide === 'short' && tpNum >= execPrice))) {
      setFormError('Take profit must be above the entry for a long, below it for a short.');
      return;
    }
    if (slNum > 0 && ((perpSide === 'long' && slNum >= execPrice) || (perpSide === 'short' && slNum <= execPrice))) {
      setFormError('Stop loss must be below the entry for a long, above it for a short.');
      return;
    }
    const summary = buildPerpOrderSummary({
      side: perpSide,
      coin: perpCoin,
      size,
      price: execPrice,
      orderType,
      leverage,
      takeProfit: tpNum > 0 ? tpNum : null,
      stopLoss: slNum > 0 ? slNum : null,
      env,
    });
    const isBuy = perpSide === 'long';
    const tp = tpNum > 0 ? tpNum : null;
    const sl = slNum > 0 ? slNum : null;
    setPending({
      summary,
      confirmLabel: perpSide === 'long' ? 'Open Long' : 'Open Short',
      onConfirm: async (signer) => {
        const hlSigner = asHyperliquidSigner(signer);
        await client.updateLeverage(hlSigner, { coin: perpCoin, leverage });
        const result =
          orderType === 'market'
            ? await client.placePerpMarketOrder(hlSigner, { coin: perpCoin, isBuy, size })
            : await client.placePerpLimitOrder(hlSigner, { coin: perpCoin, isBuy, size, price: execPrice });
        // TP/SL ride on the same signing session, as reduce-only triggers.
        if (tp !== null) {
          await client.placeTpSlOrder(hlSigner, { coin: perpCoin, isBuy: !isBuy, size, triggerPrice: tp, kind: 'tp' });
        }
        if (sl !== null) {
          await client.placeTpSlOrder(hlSigner, { coin: perpCoin, isBuy: !isBuy, size, triggerPrice: sl, kind: 'sl' });
        }
        return result;
      },
      onDone: () => {
        pushHistory(
          `Opened ${perpSide} ${perpCoin} ${leverage}x`,
          `${size.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${perpCoin} at ${fmtUsd(execPrice)} · ${fmtUsd(total)} notional`,
        );
        setAmount('');
        setLimitPrice('');
        setTakeProfit('');
        setStopLoss('');
        void refreshAccount();
      },
    });
  }

  function reviewClosePosition(pos: PerpPosition) {
    if (!address) return;
    setPending({
      summary: buildClosePositionSummary({
        coin: pos.coin,
        side: pos.side,
        size: pos.size,
        markPrice: pos.markPrice,
        unrealizedPnl: pos.unrealizedPnl,
        env,
      }),
      confirmLabel: 'Close Position',
      onConfirm: async (signer) => client.closePosition(asHyperliquidSigner(signer), { coin: pos.coin, address }),
      onDone: () => {
        pushHistory(`Closed ${pos.side} ${pos.coin}`, `${Math.abs(pos.size)} ${pos.coin} at market`);
        void refreshAccount();
      },
    });
  }

  function reviewCancelOrder(order: OpenOrder) {
    if (!address) return;
    setPending({
      summary: {
        title: `Cancel ${order.side} order (${env === 'testnet' ? 'Testnet' : 'Mainnet'})`,
        lines: [
          { label: 'Market', value: order.coin },
          { label: 'Side', value: order.side === 'buy' ? 'Buy' : 'Sell' },
          { label: 'Price', value: fmtUsd(order.price) },
          { label: 'Size', value: `${order.size} ${order.coin}` },
        ],
      },
      confirmLabel: 'Cancel Order',
      onConfirm: async (signer) => client.cancelOrder(asHyperliquidSigner(signer), { coin: order.coin, oid: order.oid }),
      onDone: () => {
        pushHistory(`Cancelled ${order.side} ${order.coin}`, `${order.size} @ ${fmtUsd(order.price)}`);
        void refreshAccount();
      },
    });
  }

  function reviewWithdraw() {
    setFormError('');
    const amt = parseTradeAmount(withdrawAmount);
    if (amt <= 0) {
      setFormError('Enter a withdrawal amount.');
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(withdrawTo.trim())) {
      setFormError('That withdrawal address is not valid.');
      return;
    }
    if (amt > tradingBalance) {
      setFormError(`Only ${fmtUsd(tradingBalance)} is available to withdraw.`);
      return;
    }
    setPending({
      summary: buildWithdrawSummary({ amount: amt, destination: withdrawTo.trim(), env }),
      confirmLabel: 'Withdraw',
      onConfirm: async (signer) =>
        client.withdraw(asHyperliquidSigner(signer), { destination: withdrawTo.trim(), amount: amt }),
      onDone: () => {
        pushHistory(`Withdrew ${fmtUsd(amt)} USDC`, 'To Arbitrum');
        setWithdrawAmount('');
        void refreshAccount();
      },
    });
  }

  const badge = envBadge(env);
  const pickList = useMemo(
    () => filterTradeMarkets(marketNames, pickerQuery),
    [marketNames, pickerQuery],
  );
  const leveragePresets = [1, 2, 5, 10, 20].filter((x) => x <= Math.min(MAX_LEVERAGE, selectedPerp?.maxLeverage ?? MAX_LEVERAGE));

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.inner,
          {
            paddingTop: 12 + insets.top,
            paddingBottom: 32 + insets.bottom,
            ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null),
          },
        ]}
      >
        <AppHeader />
        <View style={styles.head}>
          <Text style={styles.title}>Trade</Text>
          <Chip label={badge.label} tone={env === 'testnet' ? 'amber' : 'red'} />
        </View>
        <Text style={styles.envNote}>
          {env === 'testnet'
            ? 'Testnet — play money. Nothing here is real funds.'
            : 'Mainnet — real money. Every order below moves real funds.'}
        </Text>

        {/* Environment switch — explicit flip, badged everywhere. */}
        <View style={styles.envSwitch} accessibilityLabel="Environment">
          {(['testnet', 'mainnet'] as HyperliquidEnv[]).map((e) => (
            <Pressable
              key={e}
              style={[styles.envBtn, env === e && styles.envBtnActive]}
              onPress={() => setEnv(e)}
              accessibilityState={{ selected: env === e }}
            >
              <Text style={[styles.envBtnText, env === e && styles.envBtnTextActive]}>
                {e === 'testnet' ? 'Testnet' : 'Mainnet'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Spot / Perpetuals tabs */}
        <View style={styles.tabs} accessibilityLabel="Trade type">
          {(['spot', 'perp'] as TradeTab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => {
                setTab(t);
                setFormError('');
              }}
              accessibilityState={{ selected: tab === t }}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'spot' ? 'Spot' : 'Perpetuals'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Market selector */}
        <Pressable style={styles.marketBtn} onPress={() => setPickerOpen(true)}>
          <View>
            <Text style={styles.marketName}>{selectedMarket}</Text>
            <Text style={styles.marketPrice}>
              {midPrice !== null ? fmtPrice(midPrice) : 'Price unavailable'}
            </Text>
          </View>
          <ChevronDown size={18} color={COLORS.textMuted} />
        </Pressable>
        {marketsError ? <Text style={styles.formError}>{marketsError}</Text> : null}

        {/* Chart */}
        <Card style={styles.chartCard}>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>
              {selectedMarket} · 1h
            </Text>
            <Chip label={badge.label} tone={env === 'testnet' ? 'amber' : 'red'} />
          </View>
          <PriceChart
            candles={candles}
            chartType="candles"
            seriesKey={`${env}:${tab}:${selectedMarket}`}
            height={200}
            loading={chartLoading}
            updating={false}
          />
          {chartError ? <Text style={styles.hint}>{chartError}</Text> : null}
        </Card>

        {/* Funding card */}
        <Card style={styles.fundingCard}>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>Trading balance (USDC)</Text>
            <Chip label={badge.label} tone={env === 'testnet' ? 'amber' : 'red'} />
          </View>
          <Text style={styles.balance}>{fmtUsd(tradingBalance)}</Text>
          <Text style={styles.hint}>
            Withdrawable {fmtUsd(perpAccount?.withdrawable ?? 0)}
            {usdcSpot > 0 ? ` · Spot USDC ${fmtUsd(usdcSpot)}` : ''}
            {accountLoading ? ' · Updating…' : ''}
          </Text>
          {accountError ? <Text style={styles.formError}>{accountError}</Text> : null}
          <Text style={styles.depositText}>{depositExplainer(env)}</Text>
          {env === 'testnet' ? (
            <Btn
              label="Open Testnet Faucet"
              variant="secondary"
              onPress={() => {
                if (depositInfo.faucetUrl) void Linking.openURL(depositInfo.faucetUrl);
              }}
              style={styles.fundingBtn}
            />
          ) : (
            <View>
              {depositInfo.bridgeAddress ? (
                <Pressable
                  style={styles.bridgeRow}
                  onPress={() => {
                    void Clipboard.setStringAsync(depositInfo.bridgeAddress ?? '').then(() => {
                      setCopiedBridge(true);
                      setTimeout(() => setCopiedBridge(false), 2000);
                    });
                  }}
                >
                  <Text style={styles.bridgeLabel}>Bridge address (tap to copy)</Text>
                  <Text style={styles.bridgeValue} numberOfLines={1}>
                    {depositInfo.bridgeAddress}
                  </Text>
                  <Text style={styles.copied}>{copiedBridge ? 'Copied' : ''}</Text>
                </Pressable>
              ) : null}
              <Text style={styles.hint}>
                Minimum {depositInfo.minDepositUsdc ?? 5} USDC — smaller deposits are not credited.
              </Text>
            </View>
          )}
          <Text style={styles.label}>Withdraw to Arbitrum</Text>
          <View style={styles.withdrawRow}>
            <TextInput
              style={[styles.input, styles.withdrawInput]}
              keyboardType="decimal-pad"
              placeholder="Amount (USDC)"
              placeholderTextColor={COLORS.textMuted}
              value={withdrawAmount}
              onChangeText={(v) => {
                setWithdrawAmount(v);
                setFormError('');
              }}
            />
            <Btn label="Withdraw" variant="ghost" onPress={reviewWithdraw} style={styles.withdrawBtn} />
          </View>
          <TextInput
            style={[styles.input, styles.destInput]}
            placeholder="Destination address (Arbitrum)"
            placeholderTextColor={COLORS.textMuted}
            value={withdrawTo}
            onChangeText={setWithdrawTo}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>Withdrawals go back to Arbitrum. No separate Arbitrum transaction is needed from you.</Text>
        </Card>

        {/* ---- Spot form ---- */}
        {tab === 'spot' ? (
          <Card style={styles.formCard}>
            <Text style={styles.cardLabel}>Spot order</Text>
            <View style={styles.sideRow}>
              {(['buy', 'sell'] as OrderSide[]).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.sideBtn, side === s && (s === 'buy' ? styles.sideBuyActive : styles.sideSellActive)]}
                  onPress={() => setSide(s)}
                  accessibilityState={{ selected: side === s }}
                >
                  <Text style={[styles.sideText, side === s && styles.sideTextActive]}>{s === 'buy' ? 'Buy' : 'Sell'}</Text>
                </Pressable>
              ))}
              {(['market', 'limit'] as OrderType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeBtn, orderType === t && styles.typeBtnActive]}
                  onPress={() => setOrderType(t)}
                  accessibilityState={{ selected: orderType === t }}
                >
                  <Text style={[styles.typeText, orderType === t && styles.typeTextActive]}>
                    {t === 'market' ? 'Market' : 'Limit'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.amountRow}>
              <Pressable
                style={styles.modeBtn}
                onPress={() => setAmountMode(amountMode === 'usdc' ? 'coin' : 'usdc')}
              >
                <Text style={styles.modeText}>{amountMode === 'usdc' ? 'USDC' : spotPair.split('/')[0]}</Text>
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
                  setFormError('');
                }}
              />
            </View>
            {orderType === 'limit' ? (
              <TextInput
                style={[styles.input, styles.limitInput]}
                keyboardType="decimal-pad"
                placeholder="Limit price (USDC)"
                placeholderTextColor={COLORS.textMuted}
                value={limitPrice}
                onChangeText={(v) => {
                  setLimitPrice(v);
                  setFormError('');
                }}
              />
            ) : null}

            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Price</Text>
              <Text style={styles.qValue}>{execPrice > 0 ? fmtPrice(execPrice) : '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Size</Text>
              <Text style={styles.qValue}>
                {size > 0 ? `${size.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${spotPair.split('/')[0]}` : '—'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Estimated total</Text>
              <Text style={styles.qValue}>{total > 0 ? fmtUsd(total) : '—'}</Text>
            </View>
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <Btn
              label={side === 'buy' ? `Review Buy ${spotPair.split('/')[0]}` : `Review Sell ${spotPair.split('/')[0]}`}
              onPress={reviewSpotOrder}
              style={styles.reviewBtn}
            />

            <Text style={styles.sectionLabel}>Open spot orders</Text>
            {shownOpenOrders.length === 0 ? (
              <EmptyState title="No open spot orders" body="Orders you place here will show up here until they fill or are cancelled." />
            ) : (
              shownOpenOrders.map((o) => (
                <View key={o.oid} style={styles.orderRow}>
                  <View style={styles.orderMid}>
                    <Text style={styles.orderTitle}>
                      {o.side === 'buy' ? 'Buy' : 'Sell'} {o.coin} · {o.size}
                    </Text>
                    <Text style={styles.orderSub}>@ {fmtUsd(o.price)}</Text>
                  </View>
                  <Text style={styles.orderNote}>Cancel not available for spot orders yet</Text>
                </View>
              ))
            )}

            <Text style={styles.sectionLabel}>Spot balances</Text>
            {spotBalances.length === 0 ? (
              <Text style={styles.hint}>No spot balances yet — fund the account to see them here.</Text>
            ) : (
              spotBalances.map((b) => (
                <View key={b.coin} style={styles.summaryRow}>
                  <Text style={styles.qLabel}>{b.coin}</Text>
                  <Text style={styles.qValue}>
                    {b.available.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    {b.hold > 0 ? ` (${b.hold.toLocaleString('en-US', { maximumFractionDigits: 6 })} held)` : ''}
                  </Text>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* ---- Perpetuals form ---- */}
        {tab === 'perp' ? (
          <Card style={styles.formCard}>
            <Text style={styles.cardLabel}>Perpetual order</Text>
            <View style={styles.sideRow}>
              {(['long', 'short'] as PerpSide[]).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.sideBtn, perpSide === s && (s === 'long' ? styles.sideBuyActive : styles.sideSellActive)]}
                  onPress={() => setPerpSide(s)}
                  accessibilityState={{ selected: perpSide === s }}
                >
                  <Text style={[styles.sideText, perpSide === s && styles.sideTextActive]}>{s === 'long' ? 'Long' : 'Short'}</Text>
                </Pressable>
              ))}
              {(['market', 'limit'] as OrderType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeBtn, orderType === t && styles.typeBtnActive]}
                  onPress={() => setOrderType(t)}
                  accessibilityState={{ selected: orderType === t }}
                >
                  <Text style={[styles.typeText, orderType === t && styles.typeTextActive]}>
                    {t === 'market' ? 'Market' : 'Limit'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.amountRow}>
              <Pressable
                style={styles.modeBtn}
                onPress={() => setAmountMode(amountMode === 'usdc' ? 'coin' : 'usdc')}
              >
                <Text style={styles.modeText}>{amountMode === 'usdc' ? 'USDC' : perpCoin}</Text>
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
                  setFormError('');
                }}
              />
            </View>
            {orderType === 'limit' ? (
              <TextInput
                style={[styles.input, styles.limitInput]}
                keyboardType="decimal-pad"
                placeholder="Limit price (USDC)"
                placeholderTextColor={COLORS.textMuted}
                value={limitPrice}
                onChangeText={(v) => {
                  setLimitPrice(v);
                  setFormError('');
                }}
              />
            ) : null}

            <Text style={styles.label}>Leverage (max {Math.min(MAX_LEVERAGE, selectedPerp?.maxLeverage ?? MAX_LEVERAGE)}x)</Text>
            <View style={styles.levRow}>
              <Pressable
                style={styles.levStep}
                onPress={() => setLeverageInput(String(clampLeverage(leverage - 1, selectedPerp?.maxLeverage ?? MAX_LEVERAGE)))}
                accessibilityLabel="Decrease leverage"
              >
                <Text style={styles.levStepText}>−</Text>
              </Pressable>
              <Text style={styles.levValue}>{leverage}x</Text>
              <Pressable
                style={styles.levStep}
                onPress={() => setLeverageInput(String(clampLeverage(leverage + 1, selectedPerp?.maxLeverage ?? MAX_LEVERAGE)))}
                accessibilityLabel="Increase leverage"
              >
                <Text style={styles.levStepText}>+</Text>
              </Pressable>
              <View style={styles.levPresets}>
                {leveragePresets.map((p) => (
                  <Pressable
                    key={p}
                    style={[styles.levChip, leverage === p && styles.levChipActive]}
                    onPress={() => setLeverageInput(String(p))}
                  >
                    <Text style={[styles.levChipText, leverage === p && styles.levChipTextActive]}>{p}x</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text style={styles.hint}>Leverage is capped at {MAX_LEVERAGE}x in this app, even where Hyperliquid allows more.</Text>

            <View style={styles.tpRow}>
              <View style={styles.tpHalf}>
                <Text style={styles.label}>Take profit (optional)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="Price"
                  placeholderTextColor={COLORS.textMuted}
                  value={takeProfit}
                  onChangeText={setTakeProfit}
                />
              </View>
              <View style={styles.tpHalf}>
                <Text style={styles.label}>Stop loss (optional)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="Price"
                  placeholderTextColor={COLORS.textMuted}
                  value={stopLoss}
                  onChangeText={setStopLoss}
                />
              </View>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Price</Text>
              <Text style={styles.qValue}>{execPrice > 0 ? fmtPrice(execPrice) : '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Size</Text>
              <Text style={styles.qValue}>
                {size > 0 ? `${size.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${perpCoin}` : '—'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Notional</Text>
              <Text style={styles.qValue}>{total > 0 ? fmtUsd(total) : '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Margin used</Text>
              <Text style={styles.qValue}>{total > 0 ? fmtUsd(total / leverage) : '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Est. liquidation price</Text>
              <Text style={styles.qValue}>{estLiq !== null ? fmtUsd(estLiq) : '—'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Funding rate</Text>
              <Text style={styles.qValue}>Unavailable</Text>
            </View>
            <Text style={styles.hint}>Funding rate is not exposed here yet — positions are still charged funding by Hyperliquid.</Text>
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <Btn
              label={perpSide === 'long' ? `Review Long ${perpCoin}` : `Review Short ${perpCoin}`}
              onPress={reviewPerpOrder}
              style={styles.reviewBtn}
            />

            <Text style={styles.sectionLabel}>Positions</Text>
            {positions.length === 0 ? (
              <EmptyState title="No open positions" body="Open a long or short above and it will show here with its entry, mark and liquidation price." />
            ) : (
              positions.map((p) => (
                <View key={p.coin} style={styles.posCard}>
                  <View style={styles.cardHead}>
                    <Text style={styles.orderTitle}>
                      {p.side === 'long' ? 'Long' : 'Short'} {p.coin} {p.leverage}x
                    </Text>
                    <Text style={[styles.pnl, p.unrealizedPnl >= 0 ? styles.pnlUp : styles.pnlDown]}>
                      {p.unrealizedPnl >= 0 ? '+' : ''}
                      {fmtUsd(p.unrealizedPnl)}
                    </Text>
                  </View>
                  <Text style={styles.orderSub}>
                    Entry {fmtUsd(p.entryPrice)} · Mark {fmtUsd(p.markPrice)} · Size {Math.abs(p.size)}
                  </Text>
                  <Text style={styles.orderSub}>
                    Liquidation {p.liquidationPrice !== null ? fmtUsd(p.liquidationPrice) : '—'} · Margin {fmtUsd(p.marginUsed)}
                  </Text>
                  <Btn label="Close Position" variant="ghost" onPress={() => reviewClosePosition(p)} style={styles.closeBtn} />
                </View>
              ))
            )}

            <Text style={styles.sectionLabel}>Margin balance</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Account value</Text>
              <Text style={styles.qValue}>{fmtUsd(perpAccount?.accountValue ?? 0)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Margin used</Text>
              <Text style={styles.qValue}>{fmtUsd(perpAccount?.totalMarginUsed ?? 0)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.qLabel}>Withdrawable</Text>
              <Text style={styles.qValue}>{fmtUsd(perpAccount?.withdrawable ?? 0)}</Text>
            </View>

            <Text style={styles.sectionLabel}>Open perp orders</Text>
            {shownOpenOrders.length === 0 ? (
              <EmptyState title="No open perp orders" body="Orders you place here will show up here until they fill or are cancelled." />
            ) : (
              shownOpenOrders.map((o) => (
                <View key={o.oid} style={styles.orderRow}>
                  <View style={styles.orderMid}>
                    <Text style={styles.orderTitle}>
                      {o.side === 'buy' ? 'Buy' : 'Sell'} {o.coin} · {o.size}
                    </Text>
                    <Text style={styles.orderSub}>@ {fmtUsd(o.price)}</Text>
                  </View>
                  <Btn label="Cancel" variant="ghost" onPress={() => reviewCancelOrder(o)} style={styles.cancelBtn} />
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Order history (this session) */}
        <Card style={styles.formCard}>
          <Text style={styles.cardLabel}>Order history</Text>
          {history.length === 0 ? (
            <Text style={styles.hint}>Orders confirmed in this session will be listed here.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <Text style={styles.orderTitle}>{h.title}</Text>
                <Text style={styles.orderSub}>{h.detail}</Text>
                <Text style={styles.orderSub}>{new Date(h.at).toLocaleString('en-GB')}</Text>
              </View>
            ))
          )}
        </Card>

        {sheetError ? <Text style={styles.formError}>{sheetError}</Text> : null}

        {/* Market picker */}
        <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={tab === 'perp' ? 'Perpetual markets' : 'Spot markets'}>
          <View style={styles.searchWrap}>
            <Search size={16} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search markets"
              placeholderTextColor={COLORS.textMuted}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {pickList.map((name) => {
              const coin = tab === 'perp' ? name : name.split('/')[0];
              const px = mids[coin];
              return (
                <Pressable
                  key={name}
                  style={styles.pickRow}
                  onPress={() => {
                    if (tab === 'perp') setPerpCoin(name);
                    else setSpotPair(name);
                    setPickerOpen(false);
                    setPickerQuery('');
                  }}
                >
                  <View style={styles.pickMid}>
                    <Text style={styles.pickName}>{name}</Text>
                    <Text style={styles.pickSub}>{px !== undefined ? fmtPrice(px) : 'Price unavailable'}</Text>
                  </View>
                  {name === selectedMarket ? <Chip label="Selected" tone="mint" /> : null}
                </Pressable>
              );
            })}
            {pickList.length === 0 ? <Text style={styles.emptyBody}>No markets match that search.</Text> : null}
          </ScrollView>
        </BottomSheet>

        <TradeConfirmSheet
          visible={pending !== null}
          summary={pending?.summary ?? null}
          confirmLabel={pending?.confirmLabel ?? 'Confirm'}
          onClose={() => setPending(null)}
          onSubmitted={(result: unknown) => {
            const p = pending;
            setPending(null);
            if (p) p.onDone(result);
          }}
          onError={(message: string) => setSheetError(message)}
          onConfirm={async (signer: Signer) => {
            if (!pending) throw new Error('No order to confirm.');
            return pending.onConfirm(signer);
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800', minWidth: 0, textAlign: 'right' },
  amountRow: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10 },
  balance: { color: COLORS.text, fontSize: 30, fontWeight: '800', marginTop: 6 },
  bridgeLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  bridgeRow: { backgroundColor: COLORS.bgMuted, borderRadius: 12, marginTop: 10, padding: 10 },
  bridgeValue: { color: COLORS.text, fontSize: 12, fontWeight: '700', marginTop: 4 },
  cancelBtn: { minHeight: 36, paddingHorizontal: 12 },
  cardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chartCard: { marginTop: 12 },
  closeBtn: { marginTop: 8, minHeight: 36 },
  copied: { color: COLORS.mintDark, fontSize: 11, fontWeight: '700', marginTop: 4 },
  depositText: { color: COLORS.text, fontSize: 12, lineHeight: 17, marginTop: 10 },
  destInput: { marginTop: 8 },
  emptyBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  envBtn: { alignItems: 'center', borderRadius: 999, flex: 1, paddingVertical: 8 },
  envBtnActive: { backgroundColor: COLORS.navy },
  envBtnText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  envBtnTextActive: { color: COLORS.textOnNavy },
  envNote: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  envSwitch: { backgroundColor: COLORS.bgMuted, borderRadius: 999, flexDirection: 'row', marginTop: 12, padding: 4 },
  formCard: { marginTop: 12, padding: 12 },
  formError: { color: COLORS.red, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  fundingBtn: { marginTop: 10, minHeight: 40 },
  fundingCard: { marginTop: 12, padding: 12 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  historyRow: { borderTopColor: COLORS.border, borderTopWidth: 1, marginTop: 8, paddingTop: 8 },
  inner: { padding: 12 },
  input: { borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 12 },
  levChip: { borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  levChipActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  levChipText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  levChipTextActive: { color: COLORS.textOnNavy },
  levPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' },
  levRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  levStep: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, height: 32, justifyContent: 'center', width: 32 },
  levStepText: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  levValue: { color: COLORS.text, fontSize: 16, fontWeight: '800', minWidth: 40, textAlign: 'center' },
  limitInput: { marginTop: 10 },
  marketBtn: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12, paddingVertical: 10 },
  marketName: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  marketPrice: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  modeBtn: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  modeText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  orderMid: { flex: 1, minWidth: 0 },
  orderNote: { color: COLORS.textMuted, fontSize: 11, maxWidth: 140, textAlign: 'right' },
  orderRow: { alignItems: 'center', borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 8 },
  orderSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  orderTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickMid: { flex: 1, minWidth: 0 },
  pickName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  pickSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  pnl: { fontSize: 14, fontWeight: '800' },
  pnlDown: { color: COLORS.red },
  pnlUp: { color: COLORS.mintDark },
  posCard: { borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, marginTop: 8, padding: 10 },
  qLabel: { color: COLORS.textMuted, flexShrink: 0, fontSize: 12, marginRight: 8 },
  qValue: { color: COLORS.text, flex: 1, flexShrink: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  reviewBtn: { marginTop: 12 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  searchInput: { flex: 1, fontSize: 14 },
  searchWrap: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8 },
  sectionLabel: { color: COLORS.text, fontSize: 14, fontWeight: '800', marginTop: 16 },
  sideBtn: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, flex: 1, paddingVertical: 8 },
  sideBuyActive: { backgroundColor: COLORS.mint, borderColor: COLORS.mint },
  sideRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  sideSellActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  sideText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  sideTextActive: { color: COLORS.textOnNavy },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  tabBtn: { alignItems: 'center', borderRadius: 999, flex: 1, paddingVertical: 8 },
  tabBtnActive: { backgroundColor: COLORS.navy },
  tabText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  tabTextActive: { color: COLORS.textOnNavy },
  tabs: { backgroundColor: COLORS.bgMuted, borderRadius: 999, flexDirection: 'row', marginTop: 12, padding: 4 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  tpHalf: { flex: 1 },
  tpRow: { flexDirection: 'row', gap: 8 },
  typeBtn: { alignItems: 'center', borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, flex: 1, paddingVertical: 8 },
  typeBtnActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  typeText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  typeTextActive: { color: COLORS.textOnNavy },
  withdrawBtn: { minHeight: 40 },
  withdrawInput: { flex: 1 },
  withdrawRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
});
