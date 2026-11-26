/** Shared UI primitives — v1 compact: 11px labels, 14px body, 16–18px titles,
 *  tight 12–16px padding, small cards and buttons. White bg, navy, mint. */
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Check, ChevronLeft, X } from 'lucide-react-native';
import { COLORS, FONT, RADIUS, SHADOW } from '../theme';
import { CHAINS, useApp } from '../store/AppContext';

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
  const isDisabled = disabled || loading;
  const bg =
    isDisabled && variant === 'primary'
      ? COLORS.border
      : variant === 'primary'
        ? COLORS.navy
        : variant === 'mint'
          ? COLORS.mint
          : variant === 'danger'
            ? COLORS.red
            : variant === 'secondary'
              ? COLORS.bgMuted
              : 'transparent';
  const color =
    isDisabled && variant === 'primary'
      ? COLORS.textMuted
      : variant === 'secondary'
        ? COLORS.text
        : variant === 'ghost'
          ? COLORS.navy
          : COLORS.textOnNavy;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: !isDisabled && pressed ? 0.82 : 1 },
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
    amber: { bg: COLORS.amberSoft, fg: '#B45309' },
    navy: { bg: COLORS.navy, fg: COLORS.textOnNavy },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: map.bg }]}>
      <Text style={[styles.chipText, { color: map.fg }]}>{label}</Text>
    </View>
  );
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

/** v1-style centred screen header: back chevron left, 18px title, optional right. */
export function ScreenHeader({
  title,
  sub,
  onBack,
  right,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.headerSide} hitSlop={8}>
          <ChevronLeft size={22} color={COLORS.text} />
        </Pressable>
      ) : (
        <View style={styles.headerSide} />
      )}
      <View style={styles.headerMid}>
        <Text style={styles.headerTitle}>{title}</Text>
        {sub ? <Text style={styles.headerSub}>{sub}</Text> : null}
      </View>
      <View style={styles.headerSide}>{right}</View>
    </View>
  );
}

/** Honest empty state — used whenever live data returns nothing. */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Btn label={actionLabel} variant="ghost" onPress={onAction} style={styles.emptyBtn} />
      ) : null}
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

export function Skeleton({ height = 14, width = '100%' }: { height?: number; width?: number | string }) {
  return <View style={[styles.skeleton, { height, width }]} />;
}

/** Bottom sheet (v1 Import Token / Select Network / Wallets pattern). */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={18} color={COLORS.textMuted} />
            </Pressable>
          </View>
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

export interface SheetOption {
  key: string;
  label: string;
  sub?: string;
  selected?: boolean;
}

/** Generic single-select bottom sheet. */
export function OptionSheet({
  visible,
  onClose,
  title,
  options,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption[];
  onSelect: (key: string) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          style={[styles.option, o.selected && styles.optionSelected]}
          onPress={() => {
            onSelect(o.key);
            onClose();
          }}
        >
          <View style={styles.optionDot} />
          <View style={styles.optionMid}>
            <Text style={[styles.optionLabel, o.selected && styles.optionLabelSelected]}>{o.label}</Text>
            {o.sub ? (
              <Text style={[styles.optionSub, o.selected && styles.optionSubSelected]}>{o.sub}</Text>
            ) : null}
          </View>
          {o.selected ? <Check size={18} color={COLORS.textOnNavy} /> : null}
        </Pressable>
      ))}
      {options.length === 0 ? <EmptyState title="Nothing to choose yet" /> : null}
    </BottomSheet>
  );
}

/** Network picker — all chains from the registry, Arc first (default). */
export function NetworkSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { chain, setChain } = useApp();
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title="Select Network"
      options={CHAINS.map((c) => ({
        key: c.id,
        label: c.name,
        sub: `${c.testnet ? 'Testnet' : 'Mainnet'} · Native: ${c.nativeSymbol}${c.isDefault ? ' · Default' : ''}`,
        selected: chain.id === c.id,
      }))}
      onSelect={(id) => {
        const c = CHAINS.find((x) => x.id === id);
        if (c) setChain(c);
      }}
    />
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  btnText: { fontSize: FONT.body, fontWeight: '700' },
  card: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 12,
  },
  cardDark: { backgroundColor: COLORS.navyCard, borderColor: COLORS.navySoft },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: FONT.label, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 24 },
  emptyBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4, textAlign: 'center' },
  emptyBtn: { marginTop: 12, minHeight: 36 },
  emptyTitle: { color: COLORS.text, fontSize: FONT.body, fontWeight: '700' },
  header: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: 12,
    paddingTop: 4,
  },
  headerMid: { alignItems: 'center', flex: 1 },
  headerSide: { alignItems: 'center', justifyContent: 'center', width: 32 },
  headerSub: { color: COLORS.textMuted, fontSize: FONT.label, marginTop: 2 },
  headerTitle: { color: COLORS.text, fontSize: FONT.screenTitle, fontWeight: '800' },
  option: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    padding: 12,
  },
  optionDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 10, width: 10 },
  optionLabel: { color: COLORS.text, fontSize: FONT.body, fontWeight: '700' },
  optionLabelSelected: { color: COLORS.textOnNavy },
  optionMid: { flex: 1 },
  optionSelected: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  optionSub: { color: COLORS.textMuted, fontSize: FONT.small, marginTop: 2 },
  optionSubSelected: { color: COLORS.textOnNavyMuted },
  progressFill: { borderRadius: 999, height: '100%' },
  progressTrack: {
    backgroundColor: COLORS.bgMuted,
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  risk: { color: COLORS.textMuted, fontSize: FONT.label, lineHeight: 16, marginTop: 12 },
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 16,
  },
  sectionTitle: { color: COLORS.text, fontSize: FONT.title, fontWeight: '800' },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    padding: 16,
    paddingBottom: 24,
  },
  sheetBackdrop: { backgroundColor: 'rgba(11,18,32,0.45)', flex: 1, justifyContent: 'flex-end' },
  sheetHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: FONT.title, fontWeight: '800' },
  skeleton: { backgroundColor: COLORS.bgMuted, borderRadius: 8 },
});
