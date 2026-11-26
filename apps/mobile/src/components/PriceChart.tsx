/**
 * Advanced price chart — candlestick / line, EMA7 / EMA25, Bollinger
 * Bands, volume bars, MACD panel, RSI is shown by the parent from the
 * same candles. Tap a candle to inspect its OHLCV (crosshair). Zoom
 * (+/−) and pinch/drag change the visible window; "Latest" jumps back
 * to the live edge. The last candle updates live from the parent's poll
 * — the chart itself never invents candles: fewer than 2 candles renders
 * a "No chart data yet" state.
 *
 * Deliberately clean: no pan arrows, no candle steppers — the parent
 * owns timeframe/indicator controls and the chart never blanks itself:
 * a new series loads over the old one (see the parent's keep-stale
 * logic) and `updating` only shows a small badge, never a reload.
 *
 * Pure SVG (react-native-svg) — no heavy native chart dependency, web
 * export safe. Prices use the shared fmtPrice() (subscript notation for
 * micro prices, e.g. WKC $0.0₇3976), the same formatter as the rest of
 * the app — no local competing formatter.
 */
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ZoomIn, ZoomOut } from 'lucide-react-native';
import { COLORS } from '../theme';
import { bollingerSeries, macdSeries } from '../lib/chart';
import { fmtPrice } from '../lib/format';
import { ema, type Candle } from '../lib/prices';

export type ChartType = 'candles' | 'line';

export interface AdvancedChartProps {
  candles: Candle[];
  chartType: ChartType;
  showEma7?: boolean;
  showEma25?: boolean;
  showBollinger?: boolean;
  showVolume?: boolean;
  showMacd?: boolean;
  /** Changes when the series changes (timeframe / pair) — resets the window. */
  seriesKey: string;
  height?: number;
  /** True while the first candle fetch for this series is still in flight:
   *  render a loading skeleton, never "No chart data yet" as if final. */
  loading?: boolean;
  /** True while a refetch for a new series is in flight over the old
   *  candles: shows a small "Updating…" badge, never a blank chart. */
  updating?: boolean;
}

const W = 360;
const PAD = 8;

function pointsOf(values: number[], w: number, h: number, min: number, max: number, pad = PAD): [number, number][] {
  const range = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [
    pad + i * stepX,
    pad + (1 - (v - min) / range) * (h - pad * 2),
  ]);
}

function toPath(values: number[], w: number, h: number, min: number, max: number, pad = PAD): string {
  return pointsOf(values, w, h, min, max, pad)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

/** Closed band path: upper line left→right, then lower line right→left. */
function bandPath(upper: number[], lower: number[], w: number, h: number, min: number, max: number): string {
  const up = pointsOf(upper, w, h, min, max);
  const lo = pointsOf(lower, w, h, min, max).reverse();
  const fmt = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  return `M${up.map(fmt).join(' L')} L${lo.map(fmt).join(' L')} Z`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PriceChart({
  candles,
  chartType,
  showEma7 = true,
  showEma25 = true,
  showBollinger = false,
  showVolume = true,
  showMacd = false,
  seriesKey,
  height = 220,
  loading = false,
  updating = false,
}: AdvancedChartProps) {
  const [measuredW, setMeasuredW] = useState(W);
  const [visibleCount, setVisibleCount] = useState(60);
  const [endOffset, setEndOffset] = useState(0); // 0 = live edge
  const [selected, setSelected] = useState<number | null>(null); // index into visible
  const pinchRef = useRef<{ dist: number; count: number } | null>(null);
  const dragRef = useRef<{ x: number } | null>(null);

  // New series (timeframe / pair change): back to the live edge, full window.
  // No fade, no opacity dip — the old series stays visible until the new
  // one arrives (the parent keeps stale candles), so a timeframe tap
  // never makes the chart disappear.
  useEffect(() => {
    setEndOffset(0);
    setSelected(null);
    setVisibleCount(60);
  }, [seriesKey]);

  const end = Math.max(0, Math.min(candles.length, candles.length - endOffset));
  const start = Math.max(0, end - visibleCount);
  const visible = useMemo(() => candles.slice(start, end), [candles, start, end]);
  const atLiveEdge = endOffset === 0;

  const closes = useMemo(() => visible.map((c) => c.close), [visible]);
  const ema7 = useMemo(() => (visible.length > 1 ? ema(closes, 7) : []), [visible, closes]);
  const ema25 = useMemo(() => (visible.length > 1 ? ema(closes, 25) : []), [visible, closes]);
  const bb = useMemo(() => (showBollinger ? bollingerSeries(closes) : null), [showBollinger, closes]);
  const macd = useMemo(() => (showMacd ? macdSeries(closes) : null), [showMacd, closes]);

  const mainH = showMacd ? Math.round(height * 0.72) : height;
  const macdH = showMacd ? height - mainH - 8 : 0;
  const volH = showVolume ? Math.round(mainH * 0.18) : 0;
  const plotH = mainH - volH;

  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    if (showEma7) for (const v of ema7) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (showEma25) for (const v of ema25) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (bb) {
      for (const v of bb.upper) hi = Math.max(hi, v);
      for (const v of bb.lower) lo = Math.min(lo, v);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
    const pad = (hi - lo || hi || 1) * 0.06;
    return { min: lo - pad, max: hi + pad };
  }, [visible, ema7, ema25, bb, showEma7, showEma25]);

  const maxVol = useMemo(() => Math.max(1, ...visible.map((c) => c.volume)), [visible]);
  const yFor = (v: number) => PAD + (1 - (v - min) / (max - min || 1)) * (plotH - PAD * 2);
  const stepX = visible.length > 1 ? (W - PAD * 2) / visible.length : 0;
  const xFor = (i: number) => PAD + i * stepX + stepX / 2;
  const lastClose = visible.length > 0 ? visible[visible.length - 1].close : null;
  const selCandle = selected !== null ? visible[selected] ?? null : null;
  const inspect = selCandle ?? (visible.length > 0 ? visible[visible.length - 1] : null);
  const selX = selected !== null ? xFor(selected) : null;

  const macdScale = useMemo(() => {
    if (!macd) return { min: -1, max: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of [...macd.macd, ...macd.signal, ...macd.histogram]) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: -1, max: 1 };
    const pad = (hi - lo || 1) * 0.15;
    return { min: lo - pad, max: hi + pad };
  }, [macd]);

  function indexFromPress(e: GestureResponderEvent): number | null {
    if (visible.length === 0) return null;
    const n = e.nativeEvent as unknown as { locationX?: number; offsetX?: number; clientX?: number };
    let x = n.locationX ?? n.offsetX;
    if (x === undefined && typeof n.clientX === 'number') {
      const t = e.currentTarget as unknown as { getBoundingClientRect?: () => { left: number } } | undefined;
      const rect = t?.getBoundingClientRect?.();
      if (rect) x = n.clientX - rect.left;
    }
    if (x === undefined) return null;
    const viewX = (x / measuredW) * W;
    const idx = Math.floor((viewX - PAD) / stepX);
    return Math.max(0, Math.min(visible.length - 1, idx));
  }

  function onChartPress(e: GestureResponderEvent) {
    const idx = indexFromPress(e);
    if (idx !== null) setSelected(idx);
  }

  function onTouchStart(e: GestureResponderEvent) {
    const touches = (e.nativeEvent as unknown as { touches?: ArrayLike<{ identifier: number; locationX: number; locationY: number }> }).touches;
    if (touches && touches.length === 2) {
      const [a, b] = [touches[0], touches[1]];
      pinchRef.current = {
        dist: Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY),
        count: visibleCount,
      };
    } else if (touches && touches.length === 1) {
      dragRef.current = { x: touches[0].locationX };
    }
  }

  function onTouchMove(e: GestureResponderEvent) {
    const touches = (e.nativeEvent as unknown as { touches?: ArrayLike<{ identifier: number; locationX: number; locationY: number }> }).touches;
    if (!touches) return;
    if (touches.length === 2 && pinchRef.current && pinchRef.current.dist > 0) {
      const [a, b] = [touches[0], touches[1]];
      const dist = Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
      const ratio = dist / pinchRef.current.dist;
      if (ratio > 1.12 || ratio < 0.89) {
        setVisibleCount((c) => Math.max(10, Math.min(candles.length, Math.round(pinchRef.current!.count / ratio))));
        pinchRef.current = { dist, count: visibleCount };
      }
      return;
    }
    if (touches.length === 1 && dragRef.current && stepX > 0) {
      const dx = touches[0].locationX - dragRef.current.x;
      const candlesShift = Math.trunc(dx / ((measuredW / W) * stepX));
      if (candlesShift !== 0) {
        // Drag right = pull older candles into view (window moves back).
        setEndOffset((o) => Math.max(0, Math.min(candles.length - 1, o + candlesShift)));
        dragRef.current = { x: touches[0].locationX };
      }
    }
  }

  function onTouchEnd() {
    pinchRef.current = null;
    dragRef.current = null;
  }

  function zoom(factor: number) {
    setVisibleCount((c) => Math.max(10, Math.min(candles.length, Math.round(c / factor))));
  }

  if (visible.length < 2) {
    if (loading) {
      return (
        <View style={[styles.empty, { height }]}>
          <View style={[styles.skelBar, { width: '70%' }]} />
          <View style={[styles.skelBar, { width: '45%' }]} />
          <Text style={styles.emptySub}>Loading chart…</Text>
        </View>
      );
    }
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No chart data yet</Text>
        <Text style={styles.emptySub}>Candles will appear once the pair feed returns data.</Text>
      </View>
    );
  }

  const up = visible[visible.length - 1].close >= visible[0].open;
  const lineColor = up ? COLORS.mint : COLORS.red;
  const macdZeroY = macdH > 0 ? PAD + (1 - (0 - macdScale.min) / (macdScale.max - macdScale.min || 1)) * (macdH - PAD * 2) : 0;

  return (
    <View>
      {/* Inspect readout — selected candle, else the live last candle. */}
      <View style={styles.readout}>
        <View style={styles.readoutTop}>
          <Text style={styles.readoutTime}>{inspect ? fmtTime(inspect.time) : '—'}</Text>
          {updating ? <Text style={styles.updating}>Updating…</Text> : null}
        </View>
        {inspect ? (
          <Text style={styles.readoutValues}>
            O {fmtPrice(inspect.open)} · H {fmtPrice(inspect.high)} · L {fmtPrice(inspect.low)} · C{' '}
            {fmtPrice(inspect.close)} · Vol {inspect.volume >= 1000 ? `${(inspect.volume / 1000).toFixed(1)}k` : inspect.volume.toFixed(0)}
          </Text>
        ) : null}
      </View>

      <View
        onLayout={(e) => setMeasuredW(Math.max(200, e.nativeEvent.layout.width))}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <Svg width="100%" height={mainH} viewBox={`0 0 ${W} ${mainH}`} onPress={onChartPress}>
          {/* Bollinger fill */}
          {bb ? (
            <Path d={bandPath(bb.upper, bb.lower, W, plotH, min, max)} fill={COLORS.blue} opacity={0.06} />
          ) : null}
          {bb ? <Path d={toPath(bb.upper, W, plotH, min, max)} stroke={COLORS.blue} strokeWidth={1} fill="none" opacity={0.7} /> : null}
          {bb ? <Path d={toPath(bb.lower, W, plotH, min, max)} stroke={COLORS.blue} strokeWidth={1} fill="none" opacity={0.7} /> : null}

          {/* Volume bars */}
          {showVolume
            ? visible.map((c, i) => (
                <Rect
                  key={`v${i}`}
                  x={xFor(i) - Math.max(1, stepX * 0.3)}
                  y={plotH + ((1 - c.volume / maxVol) * volH) / 1}
                  width={Math.max(1.5, stepX * 0.6)}
                  height={Math.max(1, (c.volume / maxVol) * volH)}
                  fill={c.close >= c.open ? COLORS.mint : COLORS.red}
                  opacity={0.35}
                />
              ))
            : null}

          {/* Candlesticks or line */}
          {chartType === 'candles'
            ? visible.map((c, i) => {
                const bull = c.close >= c.open;
                const color = bull ? COLORS.mint : COLORS.red;
                const bodyTop = yFor(Math.max(c.open, c.close));
                const bodyH = Math.max(1.5, Math.abs(yFor(c.open) - yFor(c.close)));
                return (
                  <Fragment key={`c${i}`}>
                    <Line x1={xFor(i)} x2={xFor(i)} y1={yFor(c.high)} y2={yFor(c.low)} stroke={color} strokeWidth={1} />
                    <Rect
                      x={xFor(i) - Math.max(1, stepX * 0.3)}
                      y={bodyTop}
                      width={Math.max(2, stepX * 0.6)}
                      height={bodyH}
                      fill={color}
                      rx={1}
                    />
                  </Fragment>
                );
              })
            : (() => {
                const area = `${toPath(closes, W, plotH, min, max)} L${(W - PAD).toFixed(1)},${(plotH - PAD).toFixed(1)} L${PAD},${(plotH - PAD).toFixed(1)} Z`;
                return (
                  <>
                    <Path d={area} fill={lineColor} opacity={0.08} />
                    <Path d={toPath(closes, W, plotH, min, max)} stroke={lineColor} strokeWidth={2} fill="none" />
                  </>
                );
              })()}

          {/* EMA overlays */}
          {showEma7 && ema7.length > 1 ? (
            <Path d={toPath(ema7, W, plotH, min, max)} stroke={COLORS.blue} strokeWidth={1.5} fill="none" opacity={0.9} />
          ) : null}
          {showEma25 && ema25.length > 1 ? (
            <Path d={toPath(ema25, W, plotH, min, max)} stroke={COLORS.amber} strokeWidth={1.5} fill="none" opacity={0.9} />
          ) : null}

          {/* Last-price line + label */}
          {lastClose !== null ? (
            <>
              <Line x1={0} x2={W} y1={yFor(lastClose)} y2={yFor(lastClose)} stroke={lineColor} strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
              <SvgText x={W - 4} y={Math.max(10, Math.min(plotH - 4, yFor(lastClose) - 4))} fontSize={10} fill={lineColor} textAnchor="end" fontWeight="700">
                {fmtPrice(lastClose)}
              </SvgText>
            </>
          ) : null}

          {/* Crosshair on the inspected candle */}
          {selX !== null && inspect ? (
            <>
              <Line x1={selX} x2={selX} y1={0} y2={plotH} stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="3,3" />
              <Line x1={0} x2={W} y1={yFor(inspect.close)} y2={yFor(inspect.close)} stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="3,3" />
              <Circle cx={selX} cy={yFor(inspect.close)} r={3.5} fill={COLORS.navy} />
            </>
          ) : null}
        </Svg>

        {/* MACD panel */}
        {showMacd && macd ? (
          <Svg width="100%" height={macdH} viewBox={`0 0 ${W} ${macdH}`}>
            <Line x1={0} x2={W} y1={macdZeroY} y2={macdZeroY} stroke={COLORS.border} strokeWidth={1} />
            {macd.histogram.map((h, i) => {
              const y0 = macdZeroY;
              const y1 = PAD + (1 - (h - macdScale.min) / (macdScale.max - macdScale.min || 1)) * (macdH - PAD * 2);
              return (
                <Rect
                  key={`m${i}`}
                  x={xFor(i) - Math.max(1, stepX * 0.3)}
                  y={Math.min(y0, y1)}
                  width={Math.max(1.5, stepX * 0.6)}
                  height={Math.max(1, Math.abs(y1 - y0))}
                  fill={h >= 0 ? COLORS.mint : COLORS.red}
                  opacity={0.6}
                />
              );
            })}
            <Path
              d={toPath(macd.macd, W, macdH, macdScale.min, macdScale.max)}
              stroke={COLORS.blue}
              strokeWidth={1.5}
              fill="none"
            />
            <Path
              d={toPath(macd.signal, W, macdH, macdScale.min, macdScale.max)}
              stroke={COLORS.amber}
              strokeWidth={1.5}
              fill="none"
            />
            <SvgText x={PAD} y={12} fontSize={10} fill={COLORS.textMuted} fontWeight="700">
              MACD
            </SvgText>
          </Svg>
        ) : null}
      </View>

      {/* Zoom controls only — pan is drag, inspect is tap. No arrows. */}
      <View style={styles.controls}>
        <Pressable onPress={() => zoom(1 / 1.6)} style={styles.ctlBtn} hitSlop={6} accessibilityLabel="Zoom out">
          <ZoomOut size={15} color={COLORS.text} />
        </Pressable>
        <Pressable onPress={() => zoom(1.6)} style={styles.ctlBtn} hitSlop={6} accessibilityLabel="Zoom in">
          <ZoomIn size={15} color={COLORS.text} />
        </Pressable>
        {!atLiveEdge ? (
          <Pressable
            onPress={() => {
              setEndOffset(0);
              setSelected(null);
            }}
            style={[styles.ctlBtn, styles.liveBtn]}
            hitSlop={6}
          >
            <Text style={[styles.ctlText, styles.liveText]}>Latest</Text>
          </Pressable>
        ) : null}
        <Text style={styles.hint}>Tap a candle · pinch to zoom · drag to pan</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 8 },
  ctlBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: 8,
  },
  ctlText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 4, justifyContent: 'center' },
  emptySub: { color: COLORS.textMuted, fontSize: 11 },
  emptyText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  hint: { color: COLORS.textMuted, fontSize: 11, marginLeft: 'auto' },
  liveBtn: { backgroundColor: COLORS.mintSoft, borderColor: COLORS.mintSoft },
  liveText: { color: COLORS.mintDark },
  skelBar: { backgroundColor: COLORS.bgMuted, borderRadius: 6, height: 12, marginBottom: 8 },
  readout: { marginBottom: 6 },
  readoutTime: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  readoutTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  readoutValues: { color: COLORS.text, fontSize: 11, fontWeight: '700', marginTop: 2 },
  updating: { color: COLORS.amber, fontSize: 11, fontWeight: '700' },
});
