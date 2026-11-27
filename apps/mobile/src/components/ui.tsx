/** Shared UI primitives — v1 compact: 11px labels, 14px body, 16–18px titles,
 *  tight 12–16px padding, small cards and buttons. White bg, navy, mint. */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, X } from 'lucide-react-native';
import { COLORS, FONT, RADIUS, SHADOW } from '../theme';
import { useApp } from '../store/AppContext';

/** Responsive breakpoints (Group B): phones 320–430px, tablets ≥768px,
 *  web/desktop ≥1024px. Screens centre their content in a max-width
 *  column on wide screens instead of stretching full-width. */
export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    /** Very small phones (320px class) — tightest rows must wrap. */
    isSmallPhone: width < 360,
    isTablet: width >= 768,
    isDesktop: width >= 1024,
  };
}

/** Max-width centred column for screen content: full-width on phones,
 *  capped and centred on tablet/desktop. Merge into a ScrollView's
 *  contentContainerStyle or a root View's style. */
export const centeredContent: ViewStyle = {
  alignSelf: 'center',
  maxWidth: 720,
  width: '100%',
};

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

/** Bottom sheet (v1 Import Token / Select Network / Wallets pattern).
 *
 *  The backdrop pressable is a SIBLING behind the sheet, never a parent
 *  wrapping it. Previously the sheet (including its TextInput) sat inside
 *  the backdrop Pressable, so on web a click inside the contract-address
 *  textbox bubbled up to the backdrop's onPress and closed the modal the
 *  instant the user tried to type — the reported Import Token "crash"
 *  (2026-11-26). Taps inside the sheet now never reach the backdrop.
 *
 *  Keyboard: the modal content is wrapped in a KeyboardAvoidingView and
 *  the sheet's max-height shrinks by the live keyboard height, so the
 *  keyboard never covers the sheet's TextInput or primary button. When
 *  the keyboard opens the ScrollView scrolls to the end, bringing the
 *  focused input and the button at the bottom into view. */
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
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      // After the sheet shrinks, scroll the focused input and the
      // primary button at the bottom into view above the keyboard.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Shrink the sheet above the keyboard when it is open; otherwise keep
  // the 85% max-height. The 16px gap keeps the sheet off the keyboard
  // edge, and the 240px floor keeps a usable sliver on small phones.
  const sheetMaxHeight =
    keyboardHeight > 0 ? Math.max(240, windowHeight - keyboardHeight - 16) : '85%';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        enabled
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close sheet" />
          <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom, maxHeight: sheetMaxHeight }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <X size={18} color={COLORS.textMuted} />
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption[];
  onSelect: (key: string) => void;
  footer?: React.ReactNode;
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
      {footer ?? null}
    </BottomSheet>
  );
}

/** Network picker — ACTIVE chains from the merged admin registry that
 *  match the admin's network mode (Testnet / Mainnet / all when the admin
 *  has never set a mode), Arc first (default). The picker can never
 *  override the admin mode: it only lists chains the mode allows, and
 *  says so. A chain added in admin appears here after a refresh. */
export function NetworkSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { chain, setChain, availableChains, refreshChains, networkMode } = useApp();
  const chains = availableChains.filter((c) => c.active);
  // Opening the picker re-polls the admin registry immediately, so a
  // chain added / disabled / deleted in admin shows here at once
  // instead of waiting for the next ~45s poll.
  useEffect(() => {
    if (visible) void refreshChains();
  }, [visible, refreshChains]);
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title="Select Network"
      options={chains.map((c) => ({
        key: c.id,
        label: c.name,
        sub: `${c.testnet ? 'Testnet' : 'Mainnet'} · Native: ${c.nativeSymbol}${c.isDefault ? ' · Default' : ''}${c.vaultContract ? '' : ' · Vault not deployed'}${c.dexRouter ? ' · Router verified' : ''}`,
        selected: chain.id === c.id,
      }))}
      onSelect={(id) => {
        const c = chains.find((x) => x.id === id);
        if (c) setChain(c);
      }}
      footer={
        <Text style={styles.sheetHint}>
          {networkMode === null
            ? 'Showing all networks — the admin has not set a Testnet / Mainnet mode yet.'
            : `Showing ${networkMode === 'testnet' ? 'Testnet' : 'Mainnet'} networks only — set by the admin. The picker cannot override the admin mode.`}
        </Text>
      }
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
  sheetHint: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 17, marginTop: 12 },
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
    alignSelf: 'center',
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    maxWidth: 560,
    padding: 16,
    paddingBottom: 24,
    width: '100%',
  },
  sheetAvoiding: { flex: 1 },
  sheetBackdrop: { alignItems: 'center', backgroundColor: 'rgba(11,18,32,0.45)', flex: 1, justifyContent: 'flex-end' },
  sheetContent: { paddingBottom: 4 },
  sheetScroll: { flexShrink: 1 },
  sheetHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: FONT.title, fontWeight: '800' },
  skeleton: { backgroundColor: COLORS.bgMuted, borderRadius: 8 },
});
