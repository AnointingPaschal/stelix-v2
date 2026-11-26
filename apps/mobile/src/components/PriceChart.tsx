/** Price chart — SVG line chart with EMA7 (blue) / EMA25 (orange) overlays
 *  and volume bars, as in v1. Pure SVG (react-native-svg). Empty series
 *  renders a "No chart data yet" state instead of inventing a line. */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { COLORS } from '../theme';
import { ema } from '../lib/prices';

function toPath(values: number[], w: number, h: number, pad: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function PriceChart({
  series,
  height = 160,
  showEma = true,
}: {
  series: number[];
  height?: number;
  showEma?: boolean;
}) {
  const W = 340;
  const H = height;
  const ema7 = useMemo(() => (series.length > 1 ? ema(series, 7) : series), [series]);
  const ema25 = useMemo(() => (series.length > 1 ? ema(series, 25) : series), [series]);
  const up = series.length > 1 ? series[series.length - 1] >= series[0] : true;
  const lineColor = up ? COLORS.mint : COLORS.red;
  const vols = useMemo(() => {
    const max = Math.max(...series, 1);
    return series.map((v) => v / max);
  }, [series]);

  if (series.length < 2) {
    return (
      <View style={[styles.empty, { height: H }]}>
        <Text style={styles.emptyText}>No chart data yet</Text>
      </View>
    );
  }

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {vols.map((v, i) => (
          <Rect
            key={i}
            x={8 + (i * (W - 16)) / vols.length}
            y={H - 28 - v * 16}
            width={Math.max(2, (W - 16) / vols.length - 2)}
            height={v * 16}
            fill={COLORS.border}
            rx={1}
          />
        ))}
        {showEma && (
          <>
            <Path d={toPath(ema7, W, H - 30, 8)} stroke={COLORS.blue} strokeWidth={1.5} fill="none" opacity={0.9} />
            <Path d={toPath(ema25, W, H - 30, 8)} stroke={COLORS.amber} strokeWidth={1.5} fill="none" opacity={0.9} />
          </>
        )}
        <Path d={toPath(series, W, H - 30, 8)} stroke={lineColor} strokeWidth={2} fill="none" />
        <Line x1={0} x2={W} y1={H - 30} y2={H - 30} stroke={COLORS.border} strokeWidth={1} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 12 },
});
