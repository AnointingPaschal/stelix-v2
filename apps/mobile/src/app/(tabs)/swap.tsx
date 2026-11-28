/** Screen 10 — Swap Assets (advanced, v1 compact style).
 *
 *  Works as a full experience with or without a balance: the pickers list
 *  the chain's well-known tokens plus anything the user owns or imported
 *  (see lib/swapTokens.ts), so with $0 the user can still pick tokens,
 *  see a live quote, flip pay/receive, change slippage and watch the pair
 *  chart. The Swap button then says exactly which token is short and by
 *  how much instead of hiding the page.
 *
 *  Live quotes come from lib/swap.ts (PancakeSwap V2 on BNB, 1inch where
 *  the API key is set). When no live quote is available the page falls
 *  back to a price-ratio estimate that is labelled as estimated, never
 *  presented as a live quote — and execution always re-fetches a fresh
 *  live quote first. Arc has no verified DEX router on testnet and Solana
 *  has no EVM execution path: both say so honestly instead of faking a
 *  swap. Signing happens only in the shared SignTransactionModal — there
 *  is no password field on this page. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownUp, ChevronDown, Search, Settings } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';import { fmtNum, fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { minimumReceive, priceImpactPieces } from '../../lib/vault';
import {
  fetchCandlesForTf,
  fetchDexScreenerPairs,
  fetchMajorPrices,
  fetchTokenMarketData,
  wrappedNativeAddress,
  type Candle,
  type TokenMarketData,
} from '../../lib/prices';
import {
  estimateSwapFee,
  executeSwap,
  getSwapQuote,
  pancakeSwapPath,
  PANCAKESWAP_V2_ROUTER,
  type SwapFeeEstimate,
  type SwapQuote,
} from '../../lib/swap';
import { getSignerForChain } from '../../lib/signer';
import { mergeSwapTokens, swapButtonState, type SwapToken } from '../../lib/swapTokens';
import { BottomSheet, Btn, Card } from '../../components/ui';
import { AppHeader } from '../../components/AppShell';
import { TokenLogo } from '../../components/TokenLogo';
import { PriceChart } from '../../components/PriceChart';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../../components/SignTransactionModal';

type MarketMap = Record<string, { price: number | null; change24h: number | null }>;

export default function Swap() {
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const { tokens, chain, address, settings, addTx, refreshBalances, adminFees } = useApp();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 768;
  // Token picker list inside the bottom sheet: bounded so a long
  // catalogue scrolls inside the sheet instead of overflowing it.
  const pickListMaxHeight = Math.min(420, Math.round(height * 0.45));
  const merged = useMemo(() => mergeSwapTokens(chain.id, tokens), [chain.id, tokens]);

  const [fromSymbol, setFromSymbol] = useState<string>(chain.nativeSymbol);
  const [toSymbol, setToSymbol] = useState<string>(chain.exitStablecoin);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1.5');
  const [customSlip, setCustomSlip] = useState('');
  const [slipOpen, setSlipOpen] = useState(false);
  const [pickSide, setPickSide] = useState<'from' | 'to' | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executed, setExecuted] = useState<SignTxResult | null>(null);
  const [formError, setFormError] = useState('');
  const [signModal, setSignModal] = useState<{ request: SignTxRequest; quote: SwapQuote } | null>(null);

  const fromToken: SwapToken | undefined = merged.find((t) => t.symbol === fromSymbol);
  const toToken: SwapToken | undefined = merged.find((t) => t.symbol === toSymbol);
  const amt = parseFloat(amount) || 0;

  // --- Prefill from Home / Token Detail / Trade -----------------------
  // ?from=BNB&to=USDT pre-fills that token as pay / receive. Only applied
  // when the symbol exists on the active chain — a token from another
  // chain never silently switches the network.
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefillDone.current) return;
    const from = params.from?.toUpperCase();
    const to = params.to?.toUpperCase();
    if (!from && !to) {
      prefillDone.current = true;
      return;
    }
    if (merged.length === 0) return;
    if (from && merged.some((t) => t.symbol === from)) setFromSymbol(from);
    if (to && merged.some((t) => t.symbol === to) && to !== from) setToSymbol(to);
    prefillDone.current = true;
  }, [params.from, params.to, merged]);

  // Keep the selection valid when the chain changes.
  useEffect(() => {
    if (!merged.some((t) => t.symbol === fromSymbol)) setFromSymbol(chain.nativeSymbol);
    if (!merged.some((t) => t.symbol === toSymbol)) setToSymbol(chain.exitStablecoin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id]);

  // --- Live prices for catalogue rows (CoinGecko majors, one call) ------
  const [market, setMarket] = useState<MarketMap>({});
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(merged.map((t) => t.coingeckoId).filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    void fetchMajorPrices(ids).then((res) => {
      if (cancelled) return;
      const next: MarketMap = {};
      for (const t of merged) {
        if (!t.coingeckoId) continue;
        const r = res[t.coingeckoId];
        if (r) next[t.symbol] = { price: r.price, change24h: r.change24h };
      }
      setMarket(next);
    });
    return () => {
      cancelled = true;
    };
  }, [chain.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live price of a swap token: owned price first, then the majors feed.
  function livePrice(t: SwapToken | undefined): number | null {
    if (!t) return null;
    return t.price ?? market[t.symbol]?.price ?? null;
  }
  function liveChange(t: SwapToken | undefined): number | null {
    if (!t) return null;
    return market[t.symbol]?.change24h ?? null;
  }

  // --- Market data + liquidity for the selected pair ---------------------
  const [fromMarket, setFromMarket] = useState<TokenMarketData | null>(null);
  const [toMarket, setToMarket] = useState<TokenMarketData | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFromMarket(null);
    setToMarket(null);
    for (const [token, set] of [
      [fromToken, setFromMarket],
      [toToken, setToMarket],
    ] as const) {
      if (!token) continue;
      const addr = token.address || wrappedNativeAddress(chain.id);
      if (!addr) continue;
      void fetchTokenMarketData(chain.id, addr).then((d) => {
        if (!cancelled && d) set(d);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken?.symbol, toToken?.symbol, chain.id]);

  const fromPrice = livePrice(fromToken) ?? fromMarket?.priceUsd ?? null;
  const toPrice = livePrice(toToken) ?? toMarket?.priceUsd ?? null;
  const toChange24h = liveChange(toToken) ?? toMarket?.change24h ?? null;

  // --- Pair chart (receive token, live candles) --------------------------
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartUpdating, setChartUpdating] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const token = toToken;
    if (!token) return;
    const addr = token.address || wrappedNativeAddress(chain.id);
    if (!addr) {
      setCandles([]);
      return;
    }
    setChartLoading(candles.length === 0);
    setChartUpdating(candles.length > 0);
    void (async () => {
      const md = await fetchTokenMarketData(chain.id, addr);
      if (cancelled) return;
      if (!md?.pairAddress) {
        setCandles([]);
        setChartLoading(false);
        setChartUpdating(false);
        return;
      }
      const pairs = await fetchDexScreenerPairs(chain.id, addr);
      if (cancelled) return;
      const c = await fetchCandlesForTf(chain.id, md.pairAddress, '1d', 60, addr, {
        candidatePairs: pairs,
        coingeckoId: token.coingeckoId ?? null,
      });
      if (cancelled) return;
      setCandles(c);
      setChartLoading(false);
      setChartUpdating(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toToken?.symbol, chain.id]);

  // --- Price-ratio estimate (always available when both prices are) -----
  const estimate = useMemo(() => {
    if (!fromToken || !toToken || amt <= 0) return null;
    if (fromPrice === null || toPrice === null || toPrice <= 0) return null;
    const usd = amt * fromPrice;
    const out = usd / toPrice;
    const impact =
      toMarket?.liquidityUsd != null
        ? priceImpactPieces(usd, toMarket.liquidityUsd, adminFees.fees.maxPriceImpactPct * 100)
        : null;
    return {
      usd,
      out,
      rate: fromPrice / toPrice,
      minOut: minimumReceive(out, parseFloat(slippage) * 100 || 150),
      impact,
    };
  }, [amt, fromToken, toToken, fromPrice, toPrice, slippage, toMarket?.liquidityUsd]);

  // --- Live quote (debounced; never blocks browsing) ---------------------
  const [liveQuote, setLiveQuote] = useState<SwapQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'live' | 'unavailable'>('idle');
  const [quoteError, setQuoteError] = useState('');
  const [fee, setFee] = useState<SwapFeeEstimate | null>(null);
  useEffect(() => {
    if (!fromToken || !toToken || amt <= 0) {
      setLiveQuote(null);
      setQuoteStatus('idle');
      setQuoteError('');
      setFee(null);
      return;
    }
    setQuoteStatus('loading');
    const t = setTimeout(() => {
      void (async () => {
        try {
          const q = await getSwapQuote({
            chainId: chain.id,
            fromTokenAddress: fromToken.address,
            toTokenAddress: toToken.address,
            amountIn: amt,
            fromDecimals: fromToken.decimals,
            toDecimals: toToken.decimals,
            slippageBps: Math.round((parseFloat(slippage) || 1.5) * 100),
          });
          setLiveQuote(q);
          setQuoteStatus('live');
          setQuoteError('');
          const native = merged.find((x) => x.address === '');
          const nativePrice = native?.price ?? market[native?.symbol ?? '']?.price ?? null;
          setFee(await estimateSwapFee(q, address, nativePrice));
        } catch (e) {
          setLiveQuote(null);
          setQuoteStatus('unavailable');
          setQuoteError(e instanceof Error ? e.message : 'No live quote available.');
          setFee(null);
        }
      })();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromSymbol, toSymbol, slippage, chain.id, adminFees.fees.maxPriceImpactPct]);

  const outAmount = liveQuote?.amountOutHuman ?? estimate?.out ?? 0;
  const outMin = liveQuote?.minReceiveHuman ?? estimate?.minOut ?? 0;
  const rate = liveQuote
    ? fromPrice !== null && toPrice !== null && toPrice > 0
      ? fromPrice / toPrice
      : estimate?.rate ?? 0
    : estimate?.rate ?? 0;
  const impact = liveQuote?.priceImpactBps !== null && liveQuote?.priceImpactBps !== undefined
    ? { impactBps: liveQuote.priceImpactBps, ok: liveQuote.priceImpactBps <= adminFees.fees.maxPriceImpactPct * 100, pieces: 1 }
    : estimate?.impact ?? null;

  const route = useMemo(() => {
    if (!fromToken || !toToken) return '—';
    if (chain.id === 'bnb') {
      try {
        const path = pancakeSwapPath(fromToken.address, toToken.address);
        const sym = (addr: string) => {
          const hit = merged.find((t) => t.address.toLowerCase() === addr.toLowerCase());
          return hit?.symbol ?? `${addr.slice(0, 6)}…`;
        };
        return path.map(sym).join(' → ');
      } catch {
        return `${fromToken.symbol} → ${toToken.symbol}`;
      }
    }
    if (chain.id === 'arc') return 'No route — no DEX router verified on Arc testnet';
    return `${fromToken.symbol} → ${chain.dex.split(' ')[0]} → ${toToken.symbol}`;
  }, [fromToken, toToken, chain, merged]);

  const chainSwapNote =
    chain.kind !== 'evm'
      ? 'Swaps not available on Solana'
      : chain.id === 'arc'
        ? 'Swaps unavailable on Arc — no router verified'
        : null;

  const btn = swapButtonState({
    amount: amt,
    balance: fromToken?.balance ?? 0,
    fromSymbol: fromToken?.symbol ?? '',
    hasQuote: liveQuote !== null || estimate !== null,
    quoteLive: liveQuote !== null,
    executing,
    chainSwapNote,
  });

  function flip() {
    setFromSymbol(toSymbol);
    setToSymbol(fromSymbol);
    setAmount('');
    setFormError('');
  }

  function pickToken(symbol: string) {
    if (pickSide === 'from') {
      if (symbol === toSymbol) setToSymbol(fromSymbol);
      setFromSymbol(symbol);
    } else if (pickSide === 'to') {
      if (symbol === fromSymbol) setFromSymbol(toSymbol);
      setToSymbol(symbol);
    }
    setPickSide(null);
    setPickQuery('');
  }

  async function review() {
    setFormError('');
    if (!fromToken || !toToken) return;
    if (chainSwapNote) {
      setFormError(
        chain.id === 'arc'
          ? 'Arc swaps are unavailable — no DEX router address has been verified on Arc testnet yet. BNB swaps are live via PancakeSwap.'
          : 'Swap execution is wired for EVM chains only. No swap was executed.',
      );
      return;
    }
    if (amt <= 0) {
      setFormError('Enter an amount to swap.');
      return;
    }
    if (amt > fromToken.balance) {
      setFormError(
        `Insufficient balance — you have ${fmtNum(fromToken.balance, 4)} ${fromToken.symbol} but need ${fmtNum(amt, 4)}. Locked funds cannot be swapped.`,
      );
      return;
    }
    if (impact && !impact.ok) {
      setFormError(
        `High price impact (${(impact.impactBps / 100).toFixed(1)}%) — this swap would move the price too far. Try a smaller amount.`,
      );
      return;
    }
    // Fresh live quote at review time — execution never signs a stale quote.
    setExecuting(true);
    try {
      const q = await getSwapQuote({
        chainId: chain.id,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        amountIn: amt,
        fromDecimals: fromToken.decimals,
        toDecimals: toToken.decimals,
        slippageBps: Math.round((parseFloat(slippage) || 1.5) * 100),
      });
      setLiveQuote(q);
      const native = merged.find((x) => x.address === '');
      const nativePrice = native?.price ?? market[native?.symbol ?? '']?.price ?? null;
      const liveFee = await estimateSwapFee(q, address, nativePrice);
      setFee(liveFee);
      const valueUsd = fromPrice !== null ? amt * fromPrice : null;
      setSignModal({
        quote: q,
        request: {
          title: 'Confirm Swap',
          actionLabel: 'Sign & Send Swap',
          fromAddress: address,
          toAddress: chain.id === 'bnb' ? PANCAKESWAP_V2_ROUTER : 'Set when the swap is built',
          toLabel: chain.id === 'bnb' ? 'PancakeSwap V2 router' : 'Swap route',
          network: `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
          rows: [
            { label: 'You pay', value: `${fmtNum(amt, 4)} ${fromToken.symbol}` },
            { label: 'You receive (est.)', value: `${fmtNum(q.amountOutHuman, 4)} ${toToken.symbol}` },
            { label: 'Value', value: valueUsd !== null ? fmtUsd(valueUsd) : '—' },
            { label: 'Rate', value: `1 ${fromToken.symbol} = ${fmtPrice(rate)} ${toToken.symbol}` },
            { label: 'Minimum received', value: `${fmtNum(q.minReceiveHuman, 4)} ${toToken.symbol}` },
            { label: 'Price impact', value: impact ? `${(impact.impactBps / 100).toFixed(2)}%` : '—', danger: impact ? !impact.ok : false },
            { label: 'Slippage', value: `${slippage}%` },
            { label: 'Route', value: route },
            {
              label: 'Network fee (est.)',
              value:
                liveFee !== null
                  ? `${liveFee.feeNative} ${chain.nativeSymbol}${liveFee.feeUsd !== null ? ` (≈ ${fmtUsd(liveFee.feeUsd)})` : ''}`
                  : 'Estimated at signing',
            },
            { label: 'Quote source', value: q.source === 'pancakeswap' ? 'PancakeSwap V2 (on-chain)' : '1inch' },
          ],
          warning:
            liveFee === null && chain.id === 'bnb'
              ? 'Network fee could not be estimated — the router will show the fee before the transaction is sent.'
              : null,
          explorerBase: chain.explorerUrl,
        },
      });
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : 'No live swap quote is available right now — nothing was executed.',
      );
    } finally {
      setExecuting(false);
    }
  }

  async function signSwap(password: string): Promise<SignTxResult> {
    if (!signModal) throw new Error('No swap to sign.');
    const signer = await getSignerForChain(password, chain.id);
    const res = await executeSwap(signer, signModal.quote);
    return { hash: res.hash, blockNumber: res.blockNumber };
  }

  async function onSwapSigned(res: SignTxResult) {
    if (!signModal || !fromToken || !toToken) return;
    const q = signModal.quote;
    setExecuted(res);
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'swap',
      token: toToken.symbol,
      amount: q.amountOutHuman,
      amountRaw: q.amountOut,
      usd: estimate?.usd ?? null,
      note: `Swapped ${fmtNum(amt)} ${fromToken.symbol} → ${fmtNum(q.amountOutHuman)} ${toToken.symbol} on ${chain.name}`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: chain.id,
      blockNumber: res.blockNumber ?? null,
    });
    await refreshBalances();
  }

  const pickList = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const filtered = q
      ? merged.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      : merged;
    // Owned / non-zero balances first, then catalogue A–Z.
    return [...filtered].sort((a, b) => b.balance - a.balance || a.symbol.localeCompare(b.symbol));
  }, [merged, pickQuery]);

  const otherSideSymbol = pickSide === 'from' ? toSymbol : fromSymbol;

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
          <View style={styles.headSide} />
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Swap Assets</Text>
          <View style={styles.headRight}>
            <Pressable onPress={() => setSlipOpen(true)} style={styles.slipPill} hitSlop={6}>
              <Settings size={16} color={COLORS.navy} />
              <Text style={styles.slipPillText}>Slippage {slippage}%</Text>
            </Pressable>
          </View>
        </View>

        <Card style={styles.payCard}>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>You Pay</Text>
            <Text style={styles.bal}>
              Bal: {fmtNum(fromToken?.balance ?? 0, 4)} {fromToken?.symbol ?? ''}
              {fromPrice !== null && amt > 0 ? ` · ≈ ${fmtUsd(amt * fromPrice)}` : ''}
            </Text>
          </View>
          <View style={styles.payRow}>
            <Pressable style={styles.tokenBtn} onPress={() => setPickSide('from')}>
              {fromToken ? (
                <TokenLogo chainId={fromToken.chainId} address={fromToken.address} symbol={fromToken.symbol} size={28} fallbackTone="light" logoUrl={fromToken.logoUrl} />
              ) : null}
              <Text style={styles.tokenSymbol} numberOfLines={1}>{fromToken?.symbol ?? '—'}</Text>
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
            <Pressable style={styles.maxBtn} onPress={() => fromToken && setAmount(String(fromToken.balance))}>
              <Text style={styles.maxText}>MAX</Text>
            </Pressable>
          </View>
          <Text style={styles.tokenPrice}>
            {fromPrice !== null ? fmtPrice(fromPrice) : 'Price unavailable'}
            {liveChange(fromToken) !== null ? ` · ${liveChange(fromToken)! >= 0 ? '+' : ''}${fmtPct(liveChange(fromToken)!)} 24h` : ''}
          </Text>
        </Card>

        <View style={styles.flipWrap}>
          <Pressable onPress={flip} style={styles.flipBtn}>
            <ArrowDownUp size={18} color={COLORS.navy} />
          </Pressable>
        </View>

        <Card style={styles.payCard}>
          <View style={styles.cardHead}>
            <Text style={styles.cardLabel}>You Receive</Text>
            <Text style={styles.bal}>
              {toPrice !== null && outAmount > 0 ? `≈ ${fmtUsd(outAmount * toPrice)}` : ''}
            </Text>
          </View>
          <View style={styles.payRow}>
            <Pressable style={styles.tokenBtn} onPress={() => setPickSide('to')}>
              {toToken ? (
                <TokenLogo chainId={toToken.chainId} address={toToken.address} symbol={toToken.symbol} size={28} fallbackTone="light" logoUrl={toToken.logoUrl} />
              ) : null}
              <Text style={styles.tokenSymbol} numberOfLines={1}>{toToken?.symbol ?? '—'}</Text>
              <ChevronDown size={14} color={COLORS.textMuted} />
            </Pressable>
            <Text style={styles.amountText}>{amt > 0 ? fmtNum(outAmount, 4) : '0.00'}</Text>
          </View>
          <Text style={styles.tokenPrice}>
            {toPrice !== null ? fmtPrice(toPrice) : 'Price unavailable'}
            {toChange24h !== null ? ` · ${toChange24h >= 0 ? '+' : ''}${fmtPct(toChange24h)} 24h` : ''}
            {quoteStatus === 'loading' ? ' · Updating quote…' : quoteStatus === 'live' ? ' · Live quote' : ''}
          </Text>
        </Card>

        {toToken ? (
          <Card style={styles.chartCard}>
            <View style={styles.cardHead}>
              <Text style={styles.cardLabel}>
                {toToken.symbol} / USD · 1d
              </Text>
              <Text style={[styles.changeText, (toChange24h ?? 0) >= 0 ? styles.changeUp : styles.changeDown]}>
                {toChange24h !== null ? `${toChange24h >= 0 ? '+' : ''}${fmtPct(toChange24h)}` : '—'}
              </Text>
            </View>
            <PriceChart
              candles={candles}
              chartType="line"
              showEma7={false}
              showEma25={false}
              showVolume={false}
              showMacd={false}
              seriesKey={`${chain.id}:${toToken.address || 'native'}:swap`}
              height={140}
              loading={chartLoading}
              updating={chartUpdating}
            />
            {candles.length === 0 && !chartLoading ? (
              <Text style={styles.hint}>No chart data for this pair yet — the quote above still uses live prices when available.</Text>
            ) : null}
          </Card>
        ) : null}

        {(estimate || liveQuote) && amt > 0 ? (
          <Card style={styles.quote}>
            <QuoteRow label="Route" value={route} />
            <QuoteRow label="Rate" value={`1 ${fromToken?.symbol} = ${fmtPrice(rate)} ${toToken?.symbol}`} />
            <QuoteRow
              label="Price impact"
              value={
                impact === null
                  ? '— (liquidity data unavailable)'
                  : `${(impact.impactBps / 100).toFixed(2)}%${impact.ok ? '' : ' — too high'}`
              }
            />
            <QuoteRow label="Minimum received" value={`${fmtNum(outMin, 4)} ${toToken?.symbol}`} />
            <QuoteRow label="Slippage" value={`${slippage}%`} />
            <QuoteRow
              label="Stelix auto-sell fee (locks only)"
              value={
                adminFees.source === 'admin'
                  ? `${adminFees.fees.autoSellFeePct}% — not charged on swaps`
                  : '0% (locks only)'
              }
            />
            <QuoteRow
              label="Network fee (est.)"
              value={
                fee !== null
                  ? `${fee.feeNative} ${chain.nativeSymbol}${fee.feeUsd !== null ? ` (≈ ${fmtUsd(fee.feeUsd)})` : ''}`
                  : 'Estimated at signing'
              }
            />
            <QuoteRow label="Value" value={estimate ? `≈ ${fmtUsd(estimate.usd)}` : '—'} />
            <QuoteRow
              label="Quote"
              value={liveQuote ? (liveQuote.source === 'pancakeswap' ? 'Live · PancakeSwap V2' : 'Live · 1inch') : 'Estimated from live prices'}
            />
          </Card>
        ) : null}

        {quoteStatus === 'unavailable' && amt > 0 ? (
          <Text style={styles.quoteWarn}>Live quote unavailable — showing a price estimate instead. {quoteError}</Text>
        ) : null}
        {chainSwapNote ? <Text style={styles.quoteWarn}>{chainSwapNote}. You can still browse tokens, quotes and the chart — execution is not available on this chain.</Text> : null}
        {fromToken && amt > fromToken.balance ? (
          <Text style={styles.quoteWarn}>
            Insufficient balance — you have {fmtNum(fromToken.balance, 4)} {fromToken.symbol}
            {amt > 0 ? `, short ${fmtNum(amt - fromToken.balance, 4)} ${fromToken.symbol}` : ''}. Receive funds to swap.
          </Text>
        ) : null}
        {formError ? <Text style={styles.formError}>{formError}</Text> : null}
        {executed ? (
          <Text style={styles.sentLine}>
            Swap mined — tx {executed.hash.slice(0, 12)}…{executed.hash.slice(-6)}
            {executed.blockNumber !== null && executed.blockNumber !== undefined ? ` · block ${executed.blockNumber}` : ''}. Recorded in History.
          </Text>
        ) : null}

        <View style={styles.spacer} />
        <Btn label={btn.label} variant={btn.disabled ? 'secondary' : 'primary'} onPress={() => void review()} disabled={btn.disabled} />

        <BottomSheet visible={slipOpen} onClose={() => setSlipOpen(false)} title="Slippage tolerance">
          <View style={styles.slipRow}>
            {['0.5', '1.5', '3.0'].map((s) => (
              <Btn
                key={s}
                label={`${s}%`}
                variant={slippage === s ? 'primary' : 'ghost'}
                onPress={() => {
                  setSlippage(s);
                  setCustomSlip('');
                }}
                style={styles.slipBtn}
              />
            ))}
          </View>
          <Text style={styles.label}>Custom slippage (%)</Text>
          <TextInput
            style={styles.customSlipInput}
            keyboardType="decimal-pad"
            placeholder="e.g. 2.0"
            placeholderTextColor={COLORS.textMuted}
            value={customSlip}
            onChangeText={(v) => {
              setCustomSlip(v);
              const n = parseFloat(v);
              if (Number.isFinite(n) && n >= 0.1 && n <= 50) setSlippage(String(n));
            }}
          />
          <Text style={styles.slipHint}>Default 1.5%. A higher tolerance helps volatile pairs fill; a lower one protects your price.</Text>
        </BottomSheet>

        <BottomSheet visible={pickSide !== null} onClose={() => setPickSide(null)} title={pickSide === 'from' ? 'You Pay' : 'You Receive'}>
          <View style={styles.searchWrap}>
            <Search size={16} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tokens"
              placeholderTextColor={COLORS.textMuted}
              value={pickQuery}
              onChangeText={setPickQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={{ maxHeight: pickListMaxHeight }} showsVerticalScrollIndicator={false}>
            {pickList.map((t) => {
            const price = t.price ?? market[t.symbol]?.price ?? null;
            const change = market[t.symbol]?.change24h ?? null;
            const disabled = t.symbol === otherSideSymbol;
            return (
              <Pressable
                key={t.symbol}
                style={[styles.pickRow, disabled && styles.pickRowDisabled]}
                onPress={() => {
                  if (!disabled) pickToken(t.symbol);
                }}
              >
                <TokenLogo chainId={t.chainId} address={t.address} symbol={t.symbol} size={28} fallbackTone="light" logoUrl={t.logoUrl} />
                <View style={styles.pickMid}>
                  <Text style={styles.pickName} numberOfLines={1}>
                    {t.symbol}
                    {t.balance === 0 ? ' · 0 balance' : ''}
                  </Text>
                  <Text style={styles.pickSub} numberOfLines={1}>
                    {t.name}
                    {price !== null ? ` · ${fmtPrice(price)}` : ''}
                    {change !== null ? ` · ${change >= 0 ? '+' : ''}${fmtPct(change)}` : ''}
                  </Text>
                </View>
                <Text style={styles.pickBal} numberOfLines={1}>{fmtNum(t.balance, 4)}</Text>
              </Pressable>
            );
          })}
            {pickList.length === 0 ? <Text style={styles.emptyBody}>No tokens match that search.</Text> : null}
          </ScrollView>
        </BottomSheet>

        <SignTransactionModal
          visible={signModal !== null}
          request={signModal?.request ?? null}
          biometricsEnabled={settings.biometrics}
          onClose={() => setSignModal(null)}
          onSign={signSwap}
          onSigned={(res) => void onSwapSigned(res)}
        />
      </ScrollView>
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
  amountText: { color: COLORS.text, flex: 1, fontSize: 20, fontWeight: '800', minWidth: 0, textAlign: 'right' },
  bal: { color: COLORS.textMuted, fontSize: 12 },
  cardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  changeDown: { color: COLORS.red },
  changeText: { fontSize: 12, fontWeight: '700' },
  changeUp: { color: COLORS.mintDark },
  chartCard: { marginTop: 12 },
  customSlipInput: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emptyBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
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
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headRight: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: 10 },
  headSide: { width: 32 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  inner: { padding: 12 },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 14 },
  maxBtn: { backgroundColor: COLORS.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  maxText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  payCard: { marginTop: 12, padding: 12 },
  payRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  pickBal: { color: COLORS.text, flexShrink: 0, fontSize: 12, fontWeight: '700' },
  pickMid: { flex: 1, minWidth: 0 },
  pickName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  pickRowDisabled: { opacity: 0.4 },
  pickSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  qLabel: { color: COLORS.textMuted, flexShrink: 0, fontSize: 12, marginRight: 8 },
  qRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  qValue: { color: COLORS.text, flex: 1, flexShrink: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  quote: { marginTop: 12 },
  quoteWarn: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  searchInput: { flex: 1, fontSize: 14 },
  searchWrap: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sentLine: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  slipPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  slipPillText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  slipBtn: { flex: 1, minHeight: 36 },
  slipHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  slipRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  spacer: { flex: 1, minHeight: 24 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  tokenBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tokenPrice: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  tokenSymbol: { color: COLORS.text, flexShrink: 1, fontSize: 14, fontWeight: '700' },
});
