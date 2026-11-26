/** Token row + lock card shared by Home, Discover and Vault Hub.
 *  v1 layout: navy circle with the token's FIRST letter, symbol 14 bold,
 *  price + 24h pill underneath, value right-aligned with balance below. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Lock } from 'lucide-react-native';
import { COLORS } from '../theme';
import { fmtNum, fmtPrice, fmtUsd, timeLeft } from '../lib/format';
import type { TokenBalance } from '../lib/balances';
import type { BullLock } from '../lib/vault';
import { targetProgress } from '../lib/vault';
import { Chip, ProgressBar } from './ui';
import { TokenLogo } from './TokenLogo';

export function TokenRow({
  token,
  onPress,
}: {
  token: TokenBalance;
  onPress: () => void;
}) {
  // TokenBalance carries no 24h change — the row shows the live price
  // (or "—" when no live price is available) and never an invented move.
  const value = token.balance * (token.price ?? 0);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <TokenLogo chainId={token.chainId} address={token.address} symbol={token.symbol} size={44} logoUrl={token.logoUrl} />
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{token.symbol}</Text>
          {token.locked > 0 && <Lock size={12} color={COLORS.mintDark} />}
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price} numberOfLines={1}>{token.price === null ? 'Price unavailable' : fmtPrice(token.price)}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.value} numberOfLines={1}>{fmtUsd(value)}</Text>
        <Text style={styles.balance} numberOfLines={1}>
          {fmtNum(token.balance, 4)} {token.symbol}
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
  const matured = Date.now() >= lock.unlockTime;
  const statusLabel =
    lock.status === 'completed'
      ? 'Completed'
      : lock.status === 'matured' || matured
        ? 'Matured'
        : lock.status === 'partially-sold'
          ? 'Partially sold'
          : lock.status === 'broken'
            ? 'Broken'
            : 'Active';
  const statusTone =
    lock.status === 'completed' || lock.status === 'partially-sold'
      ? 'mint'
      : matured || lock.status === 'matured'
        ? 'mint'
        : lock.status === 'broken'
          ? 'red'
          : 'navy';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.lockCard, pressed && { opacity: 0.8 }]}>
      <View style={styles.lockTop}>
        <TokenLogo chainId={lock.chainId} address={lock.tokenAddress} symbol={lock.tokenSymbol} size={44} />
        <View style={styles.mid}>
          <Text style={styles.name} numberOfLines={1}>{lock.tokenSymbol}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {fmtNum(lock.amountRemaining, 4)} {lock.tokenSymbol} ·{' '}
            {lock.targetMultiple ? `${lock.targetMultiple}x target` : 'Date lock'}
          </Text>
        </View>
        <Chip label={statusLabel} tone={statusTone} />
        <ChevronRight size={16} color={COLORS.textMuted} />
      </View>
      <View style={styles.lockBottom}>
        <Text style={styles.value}>{fmtUsd(value)}</Text>
        <Text style={styles.sub}>
          {lock.status === 'completed'
            ? 'Completed'
            : matured
              ? 'Matured — claim available'
              : timeLeft(lock.unlockTime - Date.now())}
        </Text>
        {lock.targetPrice ? (
          <View style={styles.progressWrap}>
            <ProgressBar value={progress} />
            <Text style={styles.progressLabel}>
              {fmtPrice(currentPrice)} / {fmtPrice(lock.targetPrice)} · {Math.round(progress * 100)}% to target
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balance: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, textAlign: 'right' },
  changePill: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lockBottom: { marginTop: 10 },
  lockCard: {
    backgroundColor: '#fff',
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
    padding: 12,
  },
  lockTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  mid: { flex: 1, minWidth: 0 },
  name: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  price: { color: COLORS.textMuted, fontSize: 12 },
  priceRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 2 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
  progressWrap: { marginTop: 8 },
  right: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  value: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
});
