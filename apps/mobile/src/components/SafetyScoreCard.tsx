/**
 * Safety Score — one compact, beautiful card (not a bullet list).
 * A circular gauge (score + risk label) on the left, and a 3×2 grid of
 * small icon chips: Liquidity, 24h Volume, Market Cap, Honeypot,
 * Holders, Mint Authority. Every chip has an icon, a label and a short
 * value — or an honest "No data" when the source has nothing. Nothing
 * is invented: a missing input is shown as missing, never as a pass.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  BarChart3,
  Droplets,
  KeyRound,
  PieChart,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { COLORS } from '../theme';
import { Chip } from './ui';
import { fmtNum } from '../lib/format';
import type { SafetyScore } from '../lib/prices';

interface SafetyChip {
  key: string;
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  /** 'good' | 'bad' | 'unknown' — drives the icon tint only. */
  tone: 'good' | 'bad' | 'unknown';
}

const GAUGE_SIZE = 84;
const GAUGE_R = 34;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

export function SafetyScoreCard({
  safety,
  holderCount,
}: {
  safety: SafetyScore | null;
  holderCount?: number | null;
}) {
  const score = safety?.score ?? null;
  const tone = score === null ? 'muted' : score >= 80 ? 'mint' : score >= 50 ? 'amber' : 'red';
  const gaugeColor = tone === 'mint' ? COLORS.mint : tone === 'amber' ? COLORS.amber : tone === 'red' ? COLORS.red : COLORS.border;
  const label = safety?.label ?? 'Insufficient data';

  const input = (name: string) => safety?.inputs.find((i) => i.name === name);
  const valueOf = (name: string): string => {
    const v = input(name)?.value;
    return !v || v === 'unknown' || v.includes('unavailable') || v.includes('no honeypot API data') || v.includes('contract data unavailable')
      ? 'No data'
      : v;
  };
  const toneOf = (name: string): 'good' | 'bad' | 'unknown' => {
    const ok = input(name)?.ok;
    return ok === null || ok === undefined ? 'unknown' : ok ? 'good' : 'bad';
  };

  const honeypot = input('Honeypot check');
  const honeypotTone: 'good' | 'bad' | 'unknown' =
    honeypot?.ok === null || honeypot?.ok === undefined ? 'unknown' : honeypot.ok ? 'good' : 'bad';
  const honeypotIcon = honeypotTone === 'good' ? ShieldCheck : honeypotTone === 'bad' ? ShieldAlert : ShieldQuestion;
  const honeypotValue =
    honeypotTone === 'good' ? 'Not flagged' : honeypotTone === 'bad' ? 'Flagged' : 'No data';

  const top10 = input('Top-10 holder share');
  const chips: SafetyChip[] = [
    { key: 'liq', label: 'Liquidity', value: valueOf('Liquidity'), icon: Droplets, tone: toneOf('Liquidity') },
    { key: 'vol', label: '24h Volume', value: valueOf('24h volume'), icon: BarChart3, tone: toneOf('24h volume') },
    { key: 'mc', label: 'Market Cap', value: valueOf('Market cap'), icon: PieChart, tone: toneOf('Market cap') },
    { key: 'hp', label: 'Honeypot', value: honeypotValue, icon: honeypotIcon, tone: honeypotTone },
    {
      key: 'holders',
      label: 'Holders',
      value: holderCount ? `${fmtNum(holderCount, 0)}` : 'No data',
      sub: top10 && top10.ok !== null && top10.ok !== undefined ? `Top 10: ${top10.value}` : undefined,
      icon: Users,
      tone: holderCount ? 'good' : 'unknown',
    },
    {
      key: 'mint',
      label: 'Mint Authority',
      value:
        input('Mint authority')?.value === 'renounced'
          ? 'Renounced'
          : input('Mint authority')?.value === 'not renounced'
            ? 'Not renounced'
            : 'No data',
      icon: KeyRound,
      tone: toneOf('Mint authority'),
    },
  ];

  return (
    <View>
      <View style={styles.top}>
        <View style={styles.gaugeWrap}>
          <Svg width={GAUGE_SIZE} height={GAUGE_SIZE}>
            <Circle cx={GAUGE_SIZE / 2} cy={GAUGE_SIZE / 2} r={GAUGE_R} stroke={COLORS.bgMuted} strokeWidth={7} fill="none" />
            {score !== null ? (
              <Circle
                cx={GAUGE_SIZE / 2}
                cy={GAUGE_SIZE / 2}
                r={GAUGE_R}
                stroke={gaugeColor}
                strokeWidth={7}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(score / 100) * GAUGE_C} ${GAUGE_C}`}
                transform={`rotate(-90 ${GAUGE_SIZE / 2} ${GAUGE_SIZE / 2})`}
              />
            ) : null}
          </Svg>
          <View style={styles.gaugeCenter}>
            <Text style={styles.gaugeNum}>{score === null ? '—' : score}</Text>
            <Text style={styles.gaugeOf}>/ 100</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <Chip label={label} tone={tone} />
          <Text style={styles.note}>Estimates from on-chain signals — not a guarantee.</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {chips.map((c) => {
          const Icon = c.icon;
          const tint =
            c.tone === 'good' ? { bg: COLORS.mintSoft, fg: COLORS.mintDark } : c.tone === 'bad' ? { bg: COLORS.redSoft, fg: COLORS.red } : { bg: COLORS.bgMuted, fg: COLORS.textMuted };
          return (
            <View key={c.key} style={styles.chip}>
              <View style={[styles.chipIcon, { backgroundColor: tint.bg }]}>
                <Icon size={15} color={tint.fg} />
              </View>
              <Text style={styles.chipLabel}>{c.label}</Text>
              <Text style={[styles.chipValue, c.value === 'No data' && styles.chipNoData]} numberOfLines={1}>
                {c.value}
              </Text>
              {c.sub ? (
                <Text style={styles.chipSub} numberOfLines={1}>
                  {c.sub}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', flexBasis: '31%', flexGrow: 1, paddingVertical: 8 },
  chipIcon: { alignItems: 'center', borderRadius: 999, height: 30, justifyContent: 'center', width: 30 },
  chipLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 5 },
  chipNoData: { color: COLORS.textMuted, fontWeight: '600' },
  chipSub: { color: COLORS.textMuted, fontSize: 10, marginTop: 1 },
  chipValue: { color: COLORS.text, fontSize: 12, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  gaugeCenter: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  gaugeNum: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  gaugeOf: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  gaugeWrap: { height: GAUGE_SIZE, position: 'relative', width: GAUGE_SIZE },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  note: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16 },
  top: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  topRight: { flex: 1, gap: 6 },
});
