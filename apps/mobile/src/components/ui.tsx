/** Shared UI primitives — clean white bg, navy cards/buttons, mint accent. */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SHADOW } from '../theme';

export function Screen({
  children,
  style,
  scroll,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

export function Card({
  children,
  dark,
  style,
}: {
  children: React.ReactNode;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, dark && styles.cardDark, SHADOW.card, style]}>{children}</View>
  );
}

export function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary'
      ? COLORS.navy
      : variant === 'mint'
        ? COLORS.mint
        : variant === 'danger'
          ? COLORS.red
          : variant === 'secondary'
            ? COLORS.bgMuted
            : 'transparent';
  const color =
    variant === 'secondary'
      ? COLORS.text
      : variant === 'ghost'
        ? COLORS.navy
        : COLORS.textOnNavy;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: COLORS.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.btnText, { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'muted' | 'mint' | 'red' | 'amber' | 'navy';
}) {
  const map = {
    muted: { bg: COLORS.bgMuted, fg: COLORS.textMuted },
    mint: { bg: COLORS.mintSoft, fg: COLORS.mintDark },
    red: { bg: COLORS.redSoft, fg: COLORS.red },
    amber: { bg: '#FEF3C7', fg: '#B45309' },
    navy: { bg: COLORS.navy, fg: COLORS.textOnNavy },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: map.bg }]}>
      <Text style={[styles.chipText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

/** Small "DEMO" badge — demo data is always labelled, never presented as live. */
export function DemoBadge() {
  return <Chip label="DEMO" tone="amber" />;
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.min(100, Math.max(0, value * 100))}%`, backgroundColor: color ?? COLORS.mint },
        ]}
      />
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

export function RiskNote({ text }: { text?: string }) {
  return (
    <Text style={styles.risk}>
      {text ??
        'Crypto prices can fall as well as rise. Stelix enforces your plan — it does not guarantee profit. Only lock funds you understand the risks of holding.'}
    </Text>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <View style={[styles.skeleton, { height, width }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  card: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 16,
  },
  cardDark: { backgroundColor: COLORS.navyCard, borderColor: COLORS.navySoft },
  btn: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
  },
  btnText: { fontSize: 16, fontWeight: '700' },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  progressTrack: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: { borderRadius: 999, height: '100%' },
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 20,
  },
  sectionTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  risk: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  skeleton: { backgroundColor: COLORS.bgMuted, borderRadius: 8 },
});
