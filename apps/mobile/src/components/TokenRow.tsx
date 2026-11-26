/** Token row + lock card shared by Home, Discover and Vault Hub. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { COLORS } from '../theme';
import { fmtNum, fmtPct, fmtPrice, fmtUsd, timeLeft } from '../lib/format';
import type { DemoToken } from '../lib/demoData';
import type { BullLock } from '../lib/vault';
import { targetProgress } from '../lib/vault';
import { Chip, ProgressBar } from './ui';

export function TokenRow({
  token,
  onPress,
}: {
  token: DemoToken;
  onPress: () => void;
}) {
  const value = token.balance * token.price;
  const lockedValue = token.locked * token.price;
  const up = token.change24h >= 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{token.symbol.slice(0, 2)}</Text>
      </View>
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{token.symbol}</Text>
          {token.locked > 0 && <Lock size={12} color={COLORS.mintDark} />}
        </View>
        <Text style={styles.sub}>{token.name}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.value}>{fmtUsd(value + lockedValue)}</Text>
        <Text style={[styles.change, { color: up ? COLORS.mintDark : COLORS.red }]}>
          {fmtPct(token.change24h)}
        </Text>
      </View>
    </Pressable>
  );
}

export function LockCard({
  lock,
  currentPrice,
  onPress,
}: {
  lock: BullLock;
  currentPrice: number;
  onPress: () => void;
}) {
  const value = lock.amountRemaining * currentPrice;
  const progress = lock.targetPrice ? targetProgress(lock, currentPrice) : 0;
  const statusTone =
    lock.status === 'completed'
      ? 'mint'
      : lock.status === 'matured'
        ? 'amber'
        : lock.status === 'partially-sold'
          ? 'mint'
          : 'navy';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.lockCard, pressed && { opacity: 0.8 }]}>
      <View style={styles.lockTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{lock.tokenSymbol.slice(0, 2)}</Text>
        </View>
        <View style={styles.mid}>
          <Text style={styles.name}>
            {fmtNum(lock.amountRemaining)} {lock.tokenSymbol}
          </Text>
          <Text style={styles.sub}>
            {lock.targetMultiple ? `Target ${lock.targetMultiple}x` : 'Date lock'} ·{' '}
            {lock.status === 'completed' ? 'Completed' : timeLeft(lock.unlockTime - Date.now())}
          </Text>
        </View>
        <Chip label={lock.status.replace('-', ' ')} tone={statusTone} />
      </View>
      <View style={styles.lockBottom}>
        <Text style={styles.value}>{fmtUsd(value)}</Text>
        {lock.targetPrice && (
          <View style={styles.progressWrap}>
            <ProgressBar value={progress} />
            <Text style={styles.progressLabel}>
              {fmtPrice(currentPrice)} / {fmtPrice(lock.targetPrice)} · {Math.round(progress * 100)}% to target
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  change: { fontSize: 13, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  lockBottom: { marginTop: 12 },
  lockCard: {
    backgroundColor: '#fff',
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  lockTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  mid: { flex: 1 },
  name: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
  progressWrap: { marginTop: 8 },
  right: { alignItems: 'flex-end' },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  value: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
});
