/** Screen 7 — Token Detail (v2): real logo header with live subscript
 *  price + 24h pill, Balance / Value / Locked cards, ADVANCED chart card
 *  (candlestick / line switch, 5m/15m/1h/4h/1d, EMA7 / EMA25, Bollinger,
 *  volume, MACD, RSI(14), tap-to-inspect OHLCV, pinch/zoom — live-polling
 *  every 8s so the last candle and the price header move without a page
 *  refresh, with a Live pulse + last-updated time), compact Safety Score
 *  card (circular gauge + icon chips, GoPlus honeypot / mint / holders
 *  where the API has data, honest "No data" otherwise), navy Create
 *  Discipline card (Bull Lock), Contract Info / Orderbook tabs, Price
 *  Performance, Market Data, Trading Activity, Your Holdings, Contract.
 *
 *  The Watchlist star persists per token in local storage. There is no
 *  price-alert engine in the wallet (no background price checker), so
 *  this page has no price-alert button — a toggle that never fires
 *  would be a dead button, not a feature.
 *
 *  Every token in My Assets opens this page in full — default (BNB,
 *  WBNB, USDT, WKC, GTAN) and imported — because the route resolves a
 *  symbol OR a contract address (see lib/tokenResolve) and native assets
 *  resolve market data + candles through their wrapped twin. Anything
 *  unavailable shows "—" / "No data", never an invented value. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Lock, RefreshCw, Star } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { isWatched, toggleWatchlist, watchKey as buildWatchKey } from '../../lib/watchlist';
import {
  COINGECKO_IDS_BY_SYMBOL,
  candlesMatchPrice,
  computeSafetyScore,
  fetchCandlesForTfWithMeta,
  fetchCoinGeckoCandles,
  fetchCoinGeckoPrice,
  fetchDexScreenerPairs,
  fetchDexScreenerToken,
  fetchGoPlusSecurity,
  fetchTokenMarketData,
  indicatorsFromCandles,
  isStablecoinSymbol,
  wrappedNativeAddress,
  type Candle,
  type GoPlusSecurity,
  type PriceSource,
  type SafetyScore,
  type TokenMarketData,
} from '../../lib/prices';
import { bucketMsFor, lastMacd, mergeLivePrice, type ChartTimeframe } from '../../lib/chart';
import { resolveTokenRef } from '../../lib/tokenResolve';
import { getChain, VAULT_NOT_DEPLOYED_MESSAGE } from '../../lib/chains';
import { getSignerForChain } from '../../lib/signer';
import {
  createLockOnChain,
  lockSummarySentence,
  minReceivePerStageUsd,
  validateLadder,
  type BreakMode,
  type BullLock,
  type CreateLockOnChainParams,
  type LadderStage,
} from '../../lib/vault';
import { useCircleWalletOptional } from '../../store/CircleWalletContext';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../../components/SignTransactionModal';
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd } from '../../lib/format';
import { Btn, BottomSheet, Card, Chip, RiskNote, SectionTitle } from '../../components/ui';
import { PriceChart, type ChartType } from '../../components/PriceChart';
import { SafetyScoreCard } from '../../components/SafetyScoreCard';
import { TokenLogo } from '../../components/TokenLogo';

const TFS: ChartTimeframe[] = ['5m', '15m', '1h', '4h', '1d'];
const LIVE_POLL_MS = 8_000;
const CANDLE_REFRESH_MS = 60_000;
const DURATIONS = [
  { label: '1 Month', days: 30 },
  { label: '5 Months', days: 150 },
  { label: '1 Year', days: 365 },
  { label: 'Custom', days: 0 },
];
const TARGETS = [2, 3, 5, 10];

const priceText = (p: number | null) => (p === null ? '—' : fmtPrice(p));
const pctText = (v: number | null) => (v === null ? '—' : fmtPct(v));

type LiveState = 'live' | 'stale' | 'unavailable';

export default function TokenDetail() {
  const { symbol: rawSymbol, address: addressParam, chainId: chainIdParam } = useLocalSearchParams<{
    symbol: string;
    address?: string;
    chainId?: string;
  }>();
  const { tokens, locks, chain: activeChain, address: walletAddress, settings, addLock, addTx, refreshLocks, adminFees, appConfig } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 320–430px phones keep the compact v1 layout; 768px+ centres the
  // column at 768px so the page never stretches edge-to-edge on web.
  const isWide = width >= 768;
  const ref = useMemo(
    () =>
      resolveTokenRef(
        { symbol: rawSymbol, address: addressParam, chainId: chainIdParam },
        tokens,
        activeChain.id,
      ),
    [rawSymbol, addressParam, chainIdParam, tokens, activeChain.id],
  );
  const sym = ref.symbol;
  const storeToken = ref.storeToken;
  const chainId = ref.chainId;
  const address = ref.address;
  // Stablecoin (USDC on Arc is the native gas asset, not a DEX pair
  // token): no pair feed, no pool liquidity, no GoPlus honeypot data.
  // Its chart comes from CoinGecko market_chart (~$1 flat line) and
  // its Safety Score is the "Stablecoin" state, never "Insufficient
  // data". See lib/prices.ts isStablecoinSymbol.
  const isStablecoin = isStablecoinSymbol(sym);
  // Native assets have no contract address: market data + candles come
  // from the wrapped twin (WBNB for BNB, …) — same price, real pair.
  const marketAddress = address || wrappedNativeAddress(chainId) || '';
  const coingeckoId = storeToken?.coingeckoId ?? COINGECKO_IDS_BY_SYMBOL[sym];

  // --- Live price tick (8s poll) -------------------------------------------
  const [tick, setTick] = useState<{ price: number | null; change24h: number | null; source: PriceSource; updatedAt: number } | null>(null);
  const [liveState, setLiveState] = useState<LiveState>('stale');
  // Manual refresh: bumping this re-runs the live-price poll effect
  // below, so the refresh icon fetches a fresh price + candles now
  // instead of only explaining the 8s auto-poll.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (liveState !== 'live') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [liveState, pulse]);

  // --- Live market data (DexScreener, GeckoTerminal fallback) ---------------
  const [market, setMarket] = useState<TokenMarketData | null>(null);
  // True once the first market fetch has resolved (even with no data) —
  // the Safety Score stays hidden until this AND GoPlus have resolved.
  const [marketDone, setMarketDone] = useState(false);
  // True once the candidate-pair list has resolved — the candle fetcher
  // must wait for this, or it fires once with no candidates and again
  // when they arrive, blanking the chart twice on every mount.
  const [pairsReady, setPairsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMarket(null);
    setMarketDone(false);
    setPairsReady(false);
    if (!marketAddress) {
      setMarketDone(true);
      setPairsReady(true);
      return;
    }
    void Promise.all([
      fetchTokenMarketData(chainId, marketAddress),
      fetchDexScreenerPairs(chainId, marketAddress),
    ]).then(([d, pairs]) => {
      if (!cancelled) {
        setMarket(d);
        setCandidatePairs(pairs);
        setMarketDone(true);
        setPairsReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [marketAddress, chainId]);

  // --- GoPlus security (honeypot / mint / holders) — EVM contracts only ---
  const [security, setSecurity] = useState<GoPlusSecurity | null>(null);
  // True once the GoPlus fetch has resolved (or does not apply: native
  // assets have no contract address, so there is nothing to wait for).
  const [securityResolved, setSecurityResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSecurity(null);
    setSecurityResolved(false);
    if (!address) {
      setSecurityResolved(true);
      return;
    }
    void fetchGoPlusSecurity(chainId, address).then((s) => {
      if (!cancelled) {
        setSecurity(s);
        setSecurityResolved(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address, chainId]);

  // --- Real candles for the chart + indicators ------------------------------
  const [tf, setTf] = useState<ChartTimeframe>('15m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesStale, setCandlesStale] = useState(false);
  const [candlesLoading, setCandlesLoading] = useState(true);
  /** A refetch for a new series is in flight while old candles are still
   *  on screen — the chart shows a small "Updating…" badge, never a blank. */
  const [candlesUpdating, setCandlesUpdating] = useState(false);
  const [candleMeta, setCandleMeta] = useState<{ baseAddress: string | null; quoteAddress: string | null; baseMatches: boolean }>({
    baseAddress: null,
    quoteAddress: null,
    baseMatches: false,
  });
  const pairAddress = market?.pairAddress ?? null;
  // All DexScreener pairs for this token, highest liquidity first — the
  // candle fetcher tries each until one has this token as its Gecko base.
  const [candidatePairs, setCandidatePairs] = useState<string[]>([]);
  // Ref mirrors so fetch effects never read a stale closure: the previous
  // series stays on screen while the next one loads.
  const candlesRef = useRef<Candle[]>([]);
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);
  const candidatePairsRef = useRef<string[]>([]);
  useEffect(() => {
    candidatePairsRef.current = candidatePairs;
  }, [candidatePairs]);

  // CHART STABILITY — root cause of the disappear/reappear bug:
  // the old effect ran `setCandles([])` + `setCandlesLoading(true)` on
  // EVERY run, and it ran 2–3 times per mount (pairAddress null, then
  // set, then candidatePairs set) plus once per timeframe tap. Every tap
  // therefore blanked the chart to the skeleton/empty state and the
  // fade-in made it "come back". This effect NEVER clears the series:
  // the previous timeframe's candles stay visible while the next one
  // loads, and an empty result keeps the old series on screen (stale
  // flag only). The skeleton shows only when no candles ever existed.
  useEffect(() => {
    let cancelled = false;
    if (!pairsReady) return; // market/pairs still loading — keep the skeleton
    if (!pairAddress) {
      // No pair at all (USDC on Arc has no DEX pair): fall back to
      // CoinGecko market_chart USD history — a flat ~$1 line for a
      // stablecoin — instead of leaving "No chart data yet". The
      // CoinGecko fallback inside fetchCandlesForTfWithMeta never
      // runs here because that function is only called with a pair.
      if (coingeckoId) {
        if (candlesRef.current.length === 0) setCandlesLoading(true);
        else setCandlesUpdating(true);
        void fetchCoinGeckoCandles(coingeckoId, tf).then((cg) => {
          if (cancelled) return;
          if (cg.length > 0) {
            setCandles(cg);
            setCandlesStale(false);
            setCandleMeta({ baseAddress: marketAddress || null, quoteAddress: null, baseMatches: true });
          } else {
            setCandlesStale(candlesRef.current.length === 0);
          }
          setCandlesLoading(false);
          setCandlesUpdating(false);
        });
      } else {
        setCandlesLoading(false); // no pair exists at all: honest empty state
      }
      return;
    }
    if (candlesRef.current.length === 0) setCandlesLoading(true);
    else setCandlesUpdating(true);
    void fetchCandlesForTfWithMeta(chainId, pairAddress, tf, 120, marketAddress, {
      candidatePairs: candidatePairsRef.current,
      coingeckoId,
    }).then((r) => {
      if (!cancelled) {
        if (r.candles.length > 0) {
          setCandles(r.candles);
          setCandlesStale(false);
        } else {
          setCandlesStale(candlesRef.current.length === 0);
        }
        setCandleMeta({ baseAddress: r.baseAddress, quoteAddress: r.quoteAddress, baseMatches: r.baseMatches });
        setCandlesLoading(false);
        setCandlesUpdating(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pairAddress, chainId, tf, marketAddress, pairsReady, coingeckoId]);

  // --- Live poll: latest price every 8s merges into the last candle --------
  useEffect(() => {
    let cancelled = false;
    const bucketMs = bucketMsFor(tf);
    const poll = async () => {
      let price: number | null = null;
      let change24h: number | null = null;
      let source: PriceSource = 'unavailable';
      if (marketAddress) {
        const ds = await fetchDexScreenerToken(chainId, marketAddress);
        if (ds?.priceUsd) {
          price = ds.priceUsd;
          change24h = ds.change24h;
          source = 'dexscreener';
        }
      }
      if (price === null && coingeckoId) {
        const cg = await fetchCoinGeckoPrice(coingeckoId);
        if (cg.price !== null) {
          price = cg.price;
          change24h = cg.change24h;
          source = 'coingecko';
        }
      }
      if (cancelled) return;
      if (price !== null) {
        setTick({ price, change24h, source, updatedAt: Date.now() });
        setLiveState('live');
        // Update the live candle in place — no refresh, no invented history.
        // Never merge a live price into a wrong-scale series: only merge
        // when the last close is already within 20% of the live price.
        // And when the price did not move, keep the SAME array reference
        // so the chart does not re-render every 8 seconds.
        setCandles((prev) => {
          if (!candlesMatchPrice(prev, price as number)) return prev;
          const last = prev[prev.length - 1];
          if (last && last.close === price) return prev;
          return mergeLivePrice(prev, price as number, bucketMs);
        });
      } else {
        setLiveState((prev) => (prev === 'live' ? 'stale' : 'unavailable'));
      }
    };
    void poll();
    const t = setInterval(() => void poll(), LIVE_POLL_MS);
    // Full candle refetch every minute, so missed buckets still arrive.
    // Replace the series only when it actually changed (new last bucket
    // or a different last close) — a wholesale replace every minute
    // re-renders the whole chart and reads as a flicker.
    const refresh = setInterval(() => {
      if (!pairAddress || cancelled) return;
      void fetchCandlesForTfWithMeta(chainId, pairAddress, tf, 120, marketAddress, {
        candidatePairs: candidatePairsRef.current,
        coingeckoId,
      }).then((r) => {
        if (!cancelled && r.candles.length > 0) {
          setCandles((prev) => {
            const next = r.candles;
            if (
              prev.length === next.length &&
              prev.length > 0 &&
              prev[prev.length - 1].time === next[next.length - 1].time &&
              prev[prev.length - 1].close === next[next.length - 1].close
            ) {
              return prev;
            }
            return next;
          });
          setCandleMeta({ baseAddress: r.baseAddress, quoteAddress: r.quoteAddress, baseMatches: r.baseMatches });
        }
      });
    }, CANDLE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(refresh);
    };
  }, [marketAddress, chainId, coingeckoId, pairAddress, tf, refreshNonce]);

  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const indicators = useMemo(() => indicatorsFromCandles(candles), [candles]);
  const rsi = indicators.rsi14;
  const macd = useMemo(() => lastMacd(closes), [closes]);

  const price = tick?.price ?? market?.priceUsd ?? storeToken?.priceUsd ?? null;
  const change24h = tick?.change24h ?? market?.change24h ?? null;
  const change1h = market?.change1h ?? null;
  const change7d = market?.change7d ?? null; // DexScreener latest API does not return 7d change
  // Price-scale guard: the rendered series must price THIS token in USD
  // (Gecko OHLCV is the USD price of the pool's base token, and the
  // CoinGecko fallback is USD too), so its last close must be within 20%
  // of the header price. Either a >20% gap on a rendered series, or no
  // usable series at all (baseMatches=false — e.g. every pool's base was
  // another token), means the chart would be on the wrong scale: show the
  // mismatch state instead of a $1 chart under a $553 header.
  const chartScaleMismatch =
    price !== null &&
    pairAddress !== null &&
    !candlesLoading &&
    ((candles.length > 0 && !candlesMatchPrice(candles, price)) ||
      (candles.length === 0 && !candleMeta.baseMatches));
  const lastCandleClose = candles.length > 0 ? candles[candles.length - 1].close : null;
  const safety = useMemo(
    () =>
      market
        ? computeSafetyScore({
            ...market,
            honeypot: security?.honeypot ?? undefined,
            mintAuthorityRenounced: security?.mintAuthorityRenounced ?? undefined,
            top10SharePct: security?.top10SharePct ?? undefined,
          })
        : null,
    [market, security],
  );
  // The Safety Score renders exactly once, only after BOTH market data
  // and GoPlus have resolved (or do not apply) — and it only changes
  // afterwards when its underlying inputs actually change. That stops the
  // transient 72 → 83 flip while the feeds were still arriving.
  const safetyReady = marketDone && securityResolved;
  const [shownSafety, setShownSafety] = useState<SafetyScore | null>(null);
  useEffect(() => {
    if (!safetyReady) return;
    setShownSafety((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(safety)) return prev;
      return safety;
    });
  }, [safetyReady, safety]);
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

  const [chartType, setChartType] = useState<ChartType>('candles');
  const [showEma, setShowEma] = useState(true);
  const [showBb, setShowBb] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [watched, setWatched] = useState(false);

  // --- Watchlist (persisted per token, listed on Home) -------------------
  // The key format lives in lib/watchlist.ts — the same key the star
  // always used, so stars saved by earlier builds keep working.
  const watchKey = buildWatchKey(chainId, address, sym);
  useEffect(() => {
    let cancelled = false;
    void isWatched(watchKey).then((w) => {
      if (!cancelled) setWatched(w);
    });
    return () => {
      cancelled = true;
    };
  }, [watchKey]);

  async function toggleWatch() {
    const next = !watched;
    setWatched(next);
    try {
      await toggleWatchlist(watchKey);
    } catch {
      // Storage failure leaves the in-memory star state as-is.
      setWatched(!next);
    }
  }

  // --- Create Discipline (Bull Lock) — all inline on this screen ---
  // There is no separate lock wizard any more: amount, duration, target
  // and exit plan are set in the card below, "Review & Lock" opens the
  // review sheet, and confirming opens the signing modal. Same rules as
  // the old 4-step wizard, same signing path (SignTransactionModal),
  // no session-password field on this page.
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState(30);
  const [customDays, setCustomDays] = useState('60');
  const [unlockMode, setUnlockMode] = useState<'date' | 'price'>('date');
  const [target, setTarget] = useState<number | null>(3);
  const [customPrice, setCustomPrice] = useState('');
  const [ladderOn, setLadderOn] = useState(false);
  const [ladder, setLadder] = useState<LadderStage[]>([
    { multiple: 2, percent: 25, status: 'pending' },
    { multiple: 3, percent: 25, status: 'pending' },
    { multiple: 5, percent: 25, status: 'pending' },
    { multiple: 10, percent: 25, status: 'pending' },
  ]);
  const [trailing, setTrailing] = useState<number | null>(1500);
  const [autoSell, setAutoSell] = useState(true);
  const [breakMode, setBreakMode] = useState<BreakMode>('immutable');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signModal, setSignModal] = useState<SignTxRequest | null>(null);
  const [circleBusy, setCircleBusy] = useState(false);
  // Inline validation error for the lock form. Never Alert.alert here:
  // on react-native-web it is an empty no-op, so the user would see
  // nothing — the same failure mode as the old Create/Import screens.
  const [lockError, setLockError] = useState<string | null>(null);

  const circle = useCircleWalletOptional();
  const useCircleLock =
    circle?.ready === true &&
    circle.activeWallet !== null &&
    (activeChain.id === 'arc' || activeChain.id === 'arc-mainnet');
  // Live fee config and feature flags (same source the wizard used).
  const fees = adminFees.fees;
  const slippageBps = Math.round(fees.defaultSlippagePct * 100);
  const feeLabel = `${fees.autoSellFeePct}%`;
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
  // Vault deployment comes from the MERGED admin registry (chain.vaultContract),
  // not the built-in registry: a vault registered in Contract Studio shows
  // as deployed here on the next admin sync, with no app rebuild.
  const vaultStatus = activeChain.vaultContract
    ? { deployed: true as const, address: activeChain.vaultContract, message: '' }
    : { deployed: false as const, address: null as string | null, message: VAULT_NOT_DEPLOYED_MESSAGE };

  const lockDays = days === 0 ? parseInt(customDays, 10) || 0 : days;
  const unlockDate = new Date(Date.now() + lockDays * 86_400_000);
  const unlockTime = Date.now() + lockDays * 86_400_000;
  const spendable = Math.max(0, balance - locked);
  const entryPrice = price ?? 0;
  const amt = parseFloat(amount) || 0;
  const targetMultiple = unlockMode === 'price' ? target : null;
  const targetPrice = targetMultiple === null ? null : customPrice ? parseFloat(customPrice) || null : price !== null ? price * targetMultiple : null;
  const exitLabel = tokenChain.exitStablecoinLabel;
  const ladderError = ladderOn ? validateLadder(ladder) : null;
  // A malformed custom price used to parse to NaN, then `|| null`
  // silently dropped the target — the lock became date-only with no
  // warning. Validate it instead.
  const customPriceError =
    targetMultiple !== null && customPrice.trim() !== '' && !(parseFloat(customPrice) > 0)
      ? 'Enter a valid custom target price (a number above 0).'
      : null;
  // Minimum receive per stage, from the real stage value (see
  // lib/vault.ts minReceivePerStageUsd) — never a hardcoded $100.
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
      chainId: activeChain.id,
      tokenSymbol: sym,
      tokenAddress: address,
      amount: amt,
      amountRemaining: amt,
      entryPrice,
      unlockTime,
      targetPrice,
      targetMultiple,
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
    [amt, activeChain.id, sym, address, entryPrice, unlockTime, targetPrice, targetMultiple, ladderOn, ladder, trailing, trailingAllowed, breakMode, fees.defaultPenaltyPct, slippageBps, minReceiveUsd],
  );

  /** "Review & Lock": validates the form, then opens the review sheet.
   *  Nothing is signed here. */
  function reviewLock() {
    setLockError(null);
    if (amt <= 0 || amt > spendable) {
      setLockError(`Enter an amount up to your spendable ${fmtNum(spendable)} ${sym}. Locked funds cannot be locked twice.`);
      return;
    }
    if (lockDays <= 0) {
      setLockError('Choose a lock duration.');
      return;
    }
    // Admin lock limits (live fee config): the USD value of the lock
    // must sit inside the admin's min / max.
    const usdValue = amt * entryPrice;
    if (entryPrice > 0 && usdValue < fees.minLockUsd) {
      setLockError(`This lock would be ${fmtUsd(usdValue)} — below the minimum lock of ${fmtUsd(fees.minLockUsd)}.`);
      return;
    }
    if (entryPrice > 0 && usdValue > fees.maxLockUsd) {
      setLockError(`This lock would be ${fmtUsd(usdValue)} — above the maximum lock of ${fmtUsd(fees.maxLockUsd)}.`);
      return;
    }
    if (ladderError) {
      setLockError(ladderError);
      return;
    }
    if (customPriceError) {
      setLockError(customPriceError);
      return;
    }
    if (unlockMode === 'price' && (price === null || !targetPrice || targetPrice <= price)) {
      setLockError('Set a price target above the current price (live price unavailable right now).');
      return;
    }
    setReviewOpen(true);
  }

  /** Review sheet Confirm: validates everything again, then opens the
   *  signing modal (or the Circle PIN UI on Arc). Nothing is signed
   *  here — the modal collects the session password (or biometrics)
   *  and calls signLock below. */
  async function confirmLock() {
    setLockError(null);
    if (customPriceError) {
      setLockError(customPriceError);
      setReviewOpen(false);
      return;
    }
    if (targetPrice !== null && entryPrice > 0 && targetPrice <= entryPrice) {
      setLockError('Target price must be above the entry price — otherwise the target is already met.');
      setReviewOpen(false);
      return;
    }
    if (activeChain.kind !== 'evm') {
      setLockError('The vault is not available on Solana — the Solana vault is an Anchor program and is not wired yet. Locks are EVM-only for now; no lock was created.');
      setReviewOpen(false);
      return;
    }
    if (!vaultStatus.deployed) {
      setLockError(`${vaultStatus.message} (${tokenChain.name}). No on-chain lock can be created yet, and no local-only lock is recorded — a lock that was never submitted is not a lock.`);
      setReviewOpen(false);
      return;
    }
    if (!storeToken || !address) {
      setLockError('The native asset cannot be locked — the vault locks ERC-20 tokens. Lock an imported token instead of the native asset.');
      setReviewOpen(false);
      return;
    }
    if (price === null || entryPrice <= 0) {
      setLockError('This token has no live price, so no entry price can be recorded on-chain. Try again when a price is available.');
      setReviewOpen(false);
      return;
    }
    const stablecoin = getChain(activeChain.id).exitStablecoinAddress;
    if (!stablecoin) {
      setLockError(`No exit stablecoin address is registered for ${tokenChain.name}. The lock cannot be created yet.`);
      setReviewOpen(false);
      return;
    }
    // Circle Arc wallet: approve + createLock in the Circle PIN UI
    // instead of the password signing modal. The vault-not-deployed
    // check above already refused, so a Circle lock can only run once
    // a vault actually exists on Arc.
    if (useCircleLock) {
      setReviewOpen(false);
      await confirmCircleLock();
      return;
    }
    setReviewOpen(false);
    setSignModal({
      title: 'Confirm Lock',
      actionLabel: 'Sign & Create Lock',
      fromAddress: walletAddress,
      toAddress: vaultStatus.address,
      toLabel: 'StelixVault contract',
      network: `${tokenChain.name}${tokenChain.testnet ? ' (testnet)' : ''}`,
      rows: [
        { label: 'You lock', value: `${fmtNum(amt)} ${sym} (${fmtUsd(amt * entryPrice)})` },
        { label: 'Unlock date', value: new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
        { label: 'Target', value: targetPrice ? `${targetMultiple}x · ${fmtPrice(targetPrice)}` : 'None — date lock' },
        { label: 'Exit', value: targetPrice ? (autoSell ? exitLabel : 'Unlock to wallet') : 'Unlock to wallet' },
        { label: 'Ladder', value: ladderOn ? ladder.map((s) => `${s.percent}% @ ${s.multiple}x`).join(' · ') : 'Off' },
        { label: 'Trailing stop', value: trailing ? `${trailing / 100}%` : 'Off' },
        { label: 'Break mode', value: breakMode === 'immutable' ? 'Immutable — no early break' : breakMode === 'penalty' ? `Penalty break — ${fees.defaultPenaltyPct}% after 24h cooling-off` : 'Guardian break — approval + 48h delay' },
        { label: 'Slippage', value: `${fees.defaultSlippagePct}%` },
        { label: 'Stelix fee', value: feeLabel },
        { label: 'Network fee', value: 'Estimated at signing' },
      ],
      warning: 'You approve the token spend, then the lock is created on-chain. The vault must be deployed on this chain — otherwise no lock is created.',
      explorerBase: tokenChain.explorerUrl,
    });
  }

  /** Shared lock parameters for both signing paths (self-custody
   *  signLock below and the Circle confirmCircleLock). Returns null
   *  when there is no lockable token / stablecoin. */
  function lockParams(): CreateLockOnChainParams | null {
    if (!storeToken || !address) return null;
    const stablecoin = getChain(activeChain.id).exitStablecoinAddress;
    if (!stablecoin) return null;
    return {
      chainId: activeChain.id,
      // Vault address from the merged admin registry: a vault registered
      // in Contract Studio is used here on the next admin sync.
      vaultAddress: activeChain.vaultContract,
      tokenAddress: address,
      tokenDecimals: storeToken.decimals ?? 18,
      stablecoinAddress: stablecoin,
      amount: amt,
      unlockTime,
      entryPriceUsd: entryPrice,
      ladder: ladderOn ? ladder : targetMultiple !== null ? [{ multiple: targetMultiple, percent: 100 }] : [],
      trailingStopBps: trailingAllowed ? trailing : null,
      breakMode,
      penaltyBps: breakMode === 'penalty' ? Math.round(fees.defaultPenaltyPct * 100) : 0,
      autoSell: preview.autoSell,
      slippageBps,
      minReceiveUsd: preview.minReceiveUsd,
    };
  }

  async function signLock(password: string): Promise<SignTxResult> {
    const params = lockParams();
    if (!params) throw new Error('No token to lock.');
    const signer = await getSignerForChain(password, activeChain.id);
    const { txHash, lockId } = await createLockOnChain(signer, params);
    return { hash: txHash, blockNumber: null, lockId };
  }

  /** Circle Arc lock: approve + createLock as two user-approved Circle
   *  contract-execution challenges (Circle PIN UI). Refuses honestly
   *  when no vault is deployed — lib/circleVault.ts returns the
   *  not-deployed reason before any challenge is created. */
  async function confirmCircleLock(): Promise<void> {
    if (!circle) return;
    const params = lockParams();
    if (!params) {
      setLockError('No token to lock.');
      return;
    }
    setCircleBusy(true);
    setLockError(null);
    try {
      const txHash = await circle.createVaultLock(params);
      await onLockSigned({ hash: txHash, blockNumber: null, lockId: null });
    } catch (e) {
      setLockError(e instanceof Error ? e.message : 'Circle lock failed. No lock was created.');
    } finally {
      setCircleBusy(false);
    }
  }

  async function onLockSigned(res: SignTxResult) {
    if (!storeToken) return;
    const lock: BullLock = {
      ...preview,
      id: res.lockId !== null && res.lockId !== undefined ? `onchain-${activeChain.id}-${res.lockId}` : `onchain-${activeChain.id}-tx-${res.hash.slice(2, 10)}`,
      txHash: res.hash,
    };
    addLock(lock);
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'lock',
      token: sym,
      amount: amt,
      amountRaw: String(amt),
      usd: amt * entryPrice,
      note: `Locked on-chain until ${new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${targetMultiple ? ` or ${targetMultiple}x` : ''} · vault ${vaultStatus.deployed ? vaultStatus.address : ''}`,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: activeChain.id,
      blockNumber: null,
    });
    await refreshLocks();
    router.replace(`/vault/${lock.id}`);
  }

  if (!ref.found) {
    return (
      <View style={[styles.missing, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
        <Text style={styles.title}>Token not found</Text>
        <Text style={styles.missingBody}>This token is not in your wallet and no contract address was given.</Text>
        <Btn label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  const liveDotColor = liveState === 'live' ? COLORS.mint : liveState === 'stale' ? COLORS.amber : COLORS.red;
  const liveLabel =
    liveState === 'live'
      ? `Live · updated ${tick ? new Date(tick.updatedAt).toLocaleTimeString('en-GB') : '—'}`
      : liveState === 'stale'
        ? 'Live data delayed — showing last known price'
        : 'Live data unavailable — showing last known price';

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
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <ChevronLeft size={22} color={COLORS.text} />
          </Pressable>
          <View style={styles.headToken}>
            <TokenLogo chainId={chainId} address={address} symbol={sym} size={36} logoUrl={storeToken?.logoUrl} />
            <View style={styles.headTokenText}>
              <Text style={styles.title} numberOfLines={1}>{sym || 'Token'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{name}</Text>
            </View>
          </View>
          <View style={styles.headRight}>
            <View style={styles.priceRow}>
              {liveState === 'live' ? (
                <Animated.View style={[styles.liveDot, { backgroundColor: liveDotColor, opacity: pulse }]} />
              ) : (
                <View style={[styles.liveDot, { backgroundColor: liveDotColor }]} />
              )}
              <Text style={styles.price} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{priceText(price)}</Text>
            </View>
            <Chip label={pctText(change24h)} tone={change24h === null ? 'muted' : up ? 'mint' : 'red'} />
          </View>
          <Pressable
            onPress={() => setRefreshNonce((n) => n + 1)}
            hitSlop={8}
            accessibilityLabel="Refresh price now"
          >
            <RefreshCw size={18} color={COLORS.text} />
          </Pressable>
        </View>

        <View style={styles.statCards}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Balance</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{fmtNum(balance, 4)} {sym}</Text>
            <Text style={styles.statSub} numberOfLines={1}>{fmtUsd(balance * (price ?? 0))}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Value</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{fmtUsd(balance * (price ?? 0))}</Text>
            <Text style={styles.statSub} numberOfLines={1}>{priceText(price)} / {sym}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Locked</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{locked > 0 ? fmtNum(locked, 4) : '—'}</Text>
            <Text style={styles.statSub} numberOfLines={1}>{locked > 0 ? 'In vault' : 'None'}</Text>
          </View>
        </View>

        <Card style={styles.chartCard}>
          <View style={styles.chartHead}>
            <View style={styles.typeSeg}>
              <Pressable onPress={() => setChartType('candles')} style={[styles.segBtn, chartType === 'candles' && styles.segBtnOn]}>
                <Text style={[styles.segText, chartType === 'candles' && styles.segTextOn]}>Candles</Text>
              </Pressable>
              <Pressable onPress={() => setChartType('line')} style={[styles.segBtn, chartType === 'line' && styles.segBtnOn]}>
                <Text style={[styles.segText, chartType === 'line' && styles.segTextOn]}>Line</Text>
              </Pressable>
            </View>
            <View style={styles.tfs}>
              {TFS.map((t) => (
                <Pressable key={t} onPress={() => setTf(t)} style={[styles.tf, tf === t && styles.tfOn]}>
                  <Text style={[styles.tfText, tf === t && styles.tfTextOn]}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.pills}>
            <TogglePill label="EMA" on={showEma} onPress={() => setShowEma((v) => !v)} color={COLORS.blue} />
            <TogglePill label="BB" on={showBb} onPress={() => setShowBb((v) => !v)} color={COLORS.blue} />
            <TogglePill label="MACD" on={showMacd} onPress={() => setShowMacd((v) => !v)} color={COLORS.amber} />
            <TogglePill label="Vol" on={showVol} onPress={() => setShowVol((v) => !v)} color={COLORS.textMuted} />
            <TogglePill label="RSI" on={showRsi} onPress={() => setShowRsi((v) => !v)} color={COLORS.mint} />
          </View>
          <View style={styles.indValues}>
            <Text style={styles.indValue}>EMA7 {candlesLoading && candles.length === 0 ? 'Loading…' : indicators.ema7 === null ? '—' : fmtPrice(indicators.ema7)}</Text>
            <Text style={styles.indValue}>EMA25 {candlesLoading && candles.length === 0 ? 'Loading…' : indicators.ema25 === null ? '—' : fmtPrice(indicators.ema25)}</Text>
            {showMacd ? (
              <Text style={styles.indValue}>
                MACD {candlesLoading && candles.length === 0 ? 'Loading…' : macd.macd === null ? '—' : fmtPrice(macd.macd)} · Sig {candlesLoading && candles.length === 0 ? 'Loading…' : macd.signal === null ? '—' : fmtPrice(macd.signal)}
              </Text>
            ) : null}
          </View>

          {chartScaleMismatch ? (
            <View style={styles.mismatch}>
              <Text style={styles.mismatchTitle}>Chart price does not match the live price — showing last known</Text>
              <Text style={styles.mismatchBody}>
                Live price {priceText(price)} · last candle {lastCandleClose === null ? '—' : fmtPrice(lastCandleClose)}. The pair feed is
                pricing this token on a different scale, so the chart is hidden rather than shown wrong.
              </Text>
            </View>
          ) : (
            <PriceChart
              candles={candles}
              chartType={chartType}
              showEma7={showEma}
              showEma25={showEma}
              showBollinger={showBb}
              showVolume={showVol}
              showMacd={showMacd}
              seriesKey={`${chainId}:${pairAddress ?? 'none'}:${tf}`}
              height={showMacd ? 250 : 210}
              loading={candlesLoading}
              updating={candlesUpdating}
              emptyTitle={isStablecoin ? `${sym} is a stablecoin` : undefined}
              emptySub={
                isStablecoin
                  ? `Price is ~$1.00 by design — no trading chart${coingeckoId ? ', and the CoinGecko price history is unavailable right now' : ''}.`
                  : undefined
              }
            />
          )}

          {showRsi ? (
            <View style={styles.rsiRow}>
              <Text style={styles.rsiLabel}>RSI(14)</Text>
              <Text style={styles.rsiValue}>
                {candlesLoading && candles.length === 0
                  ? 'Loading…'
                  : rsi === null
                    ? '—'
                    : `${rsi.toFixed(0)} — ${rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'}`}
              </Text>
            </View>
          ) : null}
          <View style={styles.chartFoot}>
            <Text style={styles.footPrice}>{priceText(price)}</Text>
            <Chip label={pctText(change24h)} tone={change24h === null ? 'muted' : up ? 'mint' : 'red'} />
          </View>
          <Text style={[styles.liveNote, liveState !== 'live' && styles.liveNoteWarn]}>{liveLabel}</Text>
          {candlesStale && !candlesLoading && !chartScaleMismatch ? (
            <Text style={styles.liveNote}>
              {isStablecoin
                ? `${sym} is a stablecoin — price is ~$1.00 by design, no trading chart.`
                : 'No candles from the pair feed yet — the chart will appear once candles arrive.'}
            </Text>
          ) : null}
        </Card>

        <SectionTitle title="Safety Score" />
        <Card>
          {!safetyReady ? (
            <View style={styles.safetySkeleton}>
              <View style={[styles.skelCircle]} />
              <View style={styles.safetySkelLines}>
                <View style={[styles.skelBar, { width: '60%' }]} />
                <View style={[styles.skelBar, { width: '85%' }]} />
                <Text style={styles.safetySkelText}>Loading safety score…</Text>
              </View>
            </View>
          ) : (
            <SafetyScoreCard safety={shownSafety} holderCount={security?.holderCount ?? null} stablecoin={isStablecoin} />
          )}
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
          <Text style={styles.discHint}>Spendable: {fmtNum(spendable, 4)} {sym}</Text>
          <View style={styles.pctRow}>
            {[25, 50, 75, 100].map((p) => (
              <Pressable key={p} onPress={() => setAmount(String((spendable * p) / 100))} style={styles.pctBtn}>
                <Text style={styles.pctBtnText}>{p}%</Text>
              </Pressable>
            ))}
          </View>

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

              <Text style={styles.discLabel}>On target hit</Text>
              <View style={styles.chips}>
                <Pressable onPress={() => setAutoSell(true)} style={[styles.chipBtn, autoSell && autoSellAllowed && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, autoSell && autoSellAllowed && styles.chipBtnTextOn]}>auto-sell to {exitLabel} (auto-sell)</Text>
                </Pressable>
                <Pressable onPress={() => setAutoSell(false)} style={[styles.chipBtn, !autoSell && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, !autoSell && styles.chipBtnTextOn]}>Unlock to wallet (manual)</Text>
                </Pressable>
              </View>
              {!autoSellAllowed ? (
                <Text style={styles.discHint}>Auto-sell is off — target hits unlock to your wallet instead.</Text>
              ) : null}

              <Text style={styles.discLabel}>Profit ladder</Text>
              <View style={styles.chips}>
                <Pressable onPress={() => setLadderOn(true)} style={[styles.chipBtn, ladderOn && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, ladderOn && styles.chipBtnTextOn]}>Ladder on</Text>
                </Pressable>
                <Pressable onPress={() => setLadderOn(false)} style={[styles.chipBtn, !ladderOn && styles.chipBtnOn]}>
                  <Text style={[styles.chipBtnText, !ladderOn && styles.chipBtnTextOn]}>Ladder off (sell all at target)</Text>
                </Pressable>
              </View>
              {ladderOn && (
                <View style={styles.ladderCard}>
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
                  {ladderError ? <Text style={styles.lockError}>{ladderError}</Text> : null}
                </View>
              )}

              <Text style={styles.discLabel}>Trailing stop</Text>
              <View style={styles.chips}>
                {trailingOptions.map((o) => (
                  <Pressable key={o.label} onPress={() => setTrailing(o.v)} style={[styles.chipBtn, trailing === o.v && styles.chipBtnOn]}>
                    <Text style={[styles.chipBtnText, trailing === o.v && styles.chipBtnTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.discHint}>
                After any target is hit, a fall of the chosen % from the peak auto-sells the remainder {exitLabel}. Slippage
                default {fees.defaultSlippagePct}% · minimum receive shown at review.
                {!trailingAllowed ? ' Trailing stop is off.' : ''}
              </Text>
            </>
          )}

          <Text style={styles.discLabel}>Break mode</Text>
          <View style={styles.chips}>
            <Pressable onPress={() => setBreakMode('immutable')} style={[styles.chipBtn, breakMode === 'immutable' && styles.chipBtnOn]}>
              <Text style={[styles.chipBtnText, breakMode === 'immutable' && styles.chipBtnTextOn]}>Immutable (strongest)</Text>
            </Pressable>
            <Pressable onPress={() => setBreakMode('penalty')} style={[styles.chipBtn, breakMode === 'penalty' && styles.chipBtnOn]}>
              <Text style={[styles.chipBtnText, breakMode === 'penalty' && styles.chipBtnTextOn]}>Penalty break ({fees.defaultPenaltyPct}%, 24h cooling-off)</Text>
            </Pressable>
            <Pressable onPress={() => setBreakMode('guardian')} style={[styles.chipBtn, breakMode === 'guardian' && styles.chipBtnOn]}>
              <Text style={[styles.chipBtnText, breakMode === 'guardian' && styles.chipBtnTextOn]}>Guardian break (Phase 2)</Text>
            </Pressable>
          </View>
          <Text style={styles.discHint}>No penalty is ever charged when a price target or the maturity date triggers the exit. Penalty default is {fees.defaultPenaltyPct}%.</Text>
          {!vaultStatus.deployed ? (
            <Text style={styles.vaultWarn}>
              Not deployed on this chain yet — testnet deploy required ({tokenChain.name}). No on-chain lock can be created yet, and no
              local-only lock is recorded — a lock that was never submitted is not a lock.
            </Text>
          ) : null}
          <Btn label="Review & Lock" variant="secondary" onPress={reviewLock} style={styles.reviewBtn} />
          {lockError ? <Text style={styles.lockError}>{lockError}</Text> : null}
        </Card>

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
              <DataRow label="RSI (14)" value={candlesLoading && candles.length === 0 ? 'Loading…' : rsi === null ? '—' : `${rsi.toFixed(0)}`} />
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

        <View style={styles.actions}>
          <Btn
            label={activeLock ? 'View Lock' : 'Lock'}
            variant="mint"
            onPress={() => (activeLock ? router.push(`/vault/${activeLock.id}`) : reviewLock())}
            style={styles.actionBtn}
          />
          <Btn label="Send" onPress={() => router.push('/send')} style={styles.actionBtn} />
          <Btn label="Swap" variant="ghost" onPress={() => router.push({ pathname: '/(tabs)/swap', params: { from: sym } })} style={styles.actionBtn} />
        </View>
        <View style={styles.iconRow}>
          <Pressable style={styles.iconBtn} onPress={() => void toggleWatch()}>
            <Star size={16} color={watched ? COLORS.navy : COLORS.textMuted} />
            <Text style={styles.iconLabel}>{watched ? 'Watching' : 'Watchlist'}</Text>
          </Pressable>
        </View>
        <RiskNote />

        {/* Review sheet — opens from "Review & Lock". Confirming here
            opens the signing modal below (or the Circle PIN UI on Arc). */}
        <BottomSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} title="Review your lock">
          <View style={styles.reviewCard}>
            <ReviewRow label="Token" value={`${fmtNum(amt)} ${sym} (${fmtUsd(amt * entryPrice)})`} />
            <ReviewRow label="Chain" value={`${tokenChain.name}${tokenChain.testnet ? ' (testnet)' : ''}`} />
            <ReviewRow
              label="Wallet"
              value={
                useCircleLock && circle?.activeWallet
                  ? `Circle Arc · ${circle.activeWallet.address.slice(0, 6)}…${circle.activeWallet.address.slice(-4)}`
                  : `Self-custody · ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
              }
            />
            <ReviewRow label="Vault contract" value={vaultStatus.deployed ? vaultStatus.address : 'Not deployed yet — testnet deploy required'} />
            <ReviewRow label="Unlock date" value={new Date(unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
            <ReviewRow label="Target" value={targetPrice ? `${targetMultiple}x · ${fmtPrice(targetPrice)}` : 'None — date lock'} />
            <ReviewRow label="Exit" value={targetPrice ? (autoSell ? exitLabel : 'Unlock to wallet') : 'Unlock to wallet'} />
            <ReviewRow label="Ladder" value={ladderOn ? ladder.map((s) => `${s.percent}% @ ${s.multiple}x`).join(' · ') : 'Off'} />
            <ReviewRow label="Trailing stop" value={trailing ? `${trailing / 100}%` : 'Off'} />
            <ReviewRow label="Break mode" value={breakMode === 'immutable' ? 'Immutable — no early break' : breakMode === 'penalty' ? `Penalty break — ${fees.defaultPenaltyPct}% after 24h cooling-off` : 'Guardian break — approval + 48h delay'} />
            <ReviewRow label="Slippage" value={`${fees.defaultSlippagePct}%`} />
            <ReviewRow label="Minimum receive" value={targetPrice ? fmtUsd(minReceiveUsd) : '—'} />
            <ReviewRow label="Stelix fee" value={feeLabel} />
            <ReviewRow label="Network fee" value="Shown by the wallet before signing" />
          </View>
          <Text style={styles.sentence}>{lockSummarySentence(preview, exitLabel)}</Text>
          <Text style={styles.reviewHint}>
            {useCircleLock
              ? 'Review the terms above, then confirm — the Circle PIN UI will ask you to approve the token approval and the lock, one at a time. Nothing is submitted until you approve both.'
              : 'Review the terms above, then confirm in the signing sheet — your session password authorises the lock.'}
          </Text>
          <Btn
            label={useCircleLock ? (circleBusy ? 'Waiting for Circle approval…' : 'Confirm with Circle') : 'Confirm Lock'}
            variant="mint"
            onPress={() => void confirmLock()}
            disabled={circleBusy}
            loading={circleBusy}
            style={styles.confirmBtn}
          />
        </BottomSheet>

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

function TogglePill({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, on && styles.pillOn]}>
      <View style={[styles.pillDot, { backgroundColor: on ? color : COLORS.border }]} />
      <Text style={[styles.pillText, !on && styles.pillTextOff]}>{label}</Text>
    </Pressable>
  );
}

function DataRow({ label, value, tone }: { label: string; value: string; tone?: 'mint' | 'red' }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text
        style={[styles.dataValue, tone === 'mint' && { color: COLORS.mintDark }, tone === 'red' && { color: COLORS.red }]}
        numberOfLines={1}
      >
        {value}
      </Text>
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
  chartCard: { marginTop: 12 },
  chartFoot: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  chartHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  dataLabel: { color: COLORS.textMuted, flexShrink: 0, fontSize: 12 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  dataValue: { color: COLORS.text, flex: 1, flexShrink: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
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
  confirmBtn: { marginTop: 14 },
  discLabel: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 14 },
  ladderCard: { backgroundColor: COLORS.navySoft, borderRadius: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 4 },
  ladderInput: { backgroundColor: COLORS.navy, borderRadius: 8, color: '#fff', fontSize: 14, padding: 8, textAlign: 'center', width: 64 },
  ladderLabel: { color: '#fff', fontSize: 14, fontWeight: '700', width: 48 },
  ladderPct: { color: COLORS.textOnNavyMuted, fontSize: 14 },
  ladderRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 6 },
  lockError: { color: '#FCA5A5', fontSize: 13, fontWeight: '600', marginTop: 10 },
  discSub: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 2 },
  discTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  disciplineCard: { marginTop: 12, padding: 14 },
  footPrice: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  head: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  headRight: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  headToken: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  headTokenText: { flex: 1, minWidth: 0 },
  iconBtn: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  iconLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  iconRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', marginTop: 14 },
  indValue: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  indValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  inner: { padding: 12 },
  liveDot: { borderRadius: 999, height: 8, width: 8 },
  liveNote: { color: COLORS.textMuted, fontSize: 11, marginTop: 8 },
  liveNoteWarn: { color: COLORS.amber },
  missing: { backgroundColor: COLORS.bg, flex: 1, gap: 12, justifyContent: 'center', padding: 16 },
  missingBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  mismatch: {
    backgroundColor: COLORS.amberSoft,
    borderRadius: 12,
    marginTop: 8,
    padding: 12,
  },
  mismatchBody: { color: '#92400E', fontSize: 12, lineHeight: 17, marginTop: 4 },
  mismatchTitle: { color: '#92400E', fontSize: 13, fontWeight: '800' },
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
  pillOn: { backgroundColor: COLORS.bgMuted },
  pillText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  pillTextOff: { color: COLORS.textMuted },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 10 },
  pctBtn: { alignItems: 'center', backgroundColor: COLORS.navySoft, borderRadius: 999, flex: 1, paddingVertical: 8 },
  pctBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pctRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  price: { color: COLORS.mintDark, flexShrink: 1, fontSize: 16, fontWeight: '800' },
  priceRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  reviewBtn: { backgroundColor: '#fff', marginTop: 14 },
  reviewCard: { backgroundColor: COLORS.navy, borderRadius: 12, marginTop: 10, padding: 12 },
  reviewHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  reviewLabel: { color: COLORS.textOnNavyMuted, flexShrink: 0, fontSize: 12 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  reviewValue: { color: '#fff', flexShrink: 1, fontSize: 12, fontWeight: '700', marginLeft: 12, textAlign: 'right' },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  rsiLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  sentence: { color: COLORS.text, fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 14 },
  rsiRow: { alignItems: 'center', borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8 },
  rsiValue: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  safetySkelLines: { flex: 1, gap: 8 },
  safetySkelText: { color: COLORS.textMuted, fontSize: 11 },
  safetySkeleton: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  segBtn: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  segBtnOn: { backgroundColor: COLORS.navy },
  segText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: '#fff' },
  skelBar: { backgroundColor: COLORS.bgMuted, borderRadius: 6, height: 12 },
  skelCircle: { backgroundColor: COLORS.bgMuted, borderRadius: 999, height: 84, width: 84 },
  statCard: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 10,
  },
  statCards: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statLabel: { color: COLORS.textMuted, fontSize: 11 },
  statSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  statValue: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 2 },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  tf: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  tfOn: { backgroundColor: COLORS.bgMuted },
  tfText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  tfTextOn: { color: COLORS.text },
  tfs: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  typeSeg: { backgroundColor: COLORS.bgMuted, borderRadius: 999, flexDirection: 'row', padding: 2 },
  unlockLine: { color: COLORS.textOnNavyMuted, fontSize: 12, marginTop: 8 },
  vaultWarn: { color: '#FCA5A5', fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: 10 },
});
