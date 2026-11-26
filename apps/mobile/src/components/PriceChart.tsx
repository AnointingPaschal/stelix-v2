/** Price chart — SVG line chart with EMA7 / EMA25 overlays and volume bars.
 *  Pure SVG (react-native-svg), no native chart dependency. */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { COLORS } from '../theme';
import { ema } from '../lib/demoData';

function toPath(values: number[], w: number, h: number, pad: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
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
  height = 180,
  showEma = true,
}: {
  series: number[];
  height?: number;
  showEma?: boolean;
}) {
  const W = 340;
  const H = height;
  const ema7 = useMemo(() => ema(series, 7), [series]);
  const ema25 = useMemo(() => ema(series, 25), [series]);
  const up = series[series.length - 1] >= series[0];
  const lineColor = up ? COLORS.mint : COLORS.red;
  const vols = useMemo(() => {
    const max = Math.max(...series);
    return series.map((v) => v / max);
  }, [series]);

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {vols.map((v, i) => (
          <Rect
            key={i}
            x={8 + (i * (W - 16)) / vols.length}
            y={H - 28 - v * 18}
            width={Math.max(2, (W - 16) / vols.length - 2)}
            height={v * 18}
            fill={COLORS.border}
            rx={1}
          />
        ))}
        {showEma && (
          <>
            <Path d={toPath(ema25, W, H - 30, 8)} stroke={COLORS.blue} strokeWidth={1.5} fill="none" opacity={0.7} />
            <Path d={toPath(ema7, W, H - 30, 8)} stroke={COLORS.amber} strokeWidth={1.5} fill="none" opacity={0.9} />
          </>
        )}
        <Path d={toPath(series, W, H - 30, 8)} stroke={lineColor} strokeWidth={2.5} fill="none" />
        <Line x1={0} x2={W} y1={H - 30} y2={H - 30} stroke={COLORS.border} strokeWidth={1} />
      </Svg>
    </View>
  );
}
