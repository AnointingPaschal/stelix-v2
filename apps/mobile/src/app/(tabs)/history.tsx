/** Screen 15 — Transaction History: centred title + live-source sub,
 *  refresh icon. Mint down-circle for Token Received, grey up-circle
 *  for Token Sent, amount right-aligned, date below. Spam hidden by
 *  default. Empty state: "No transactions yet".
 *
 *  History is keyless and never asks the user for anything: Blockscout
 *  v2 on Arc / Ethereum / Base, the public-RPC Transfer-log scan on
 *  BNB / Polygon, and the stored explorer key only as an optional
 *  enhancement when one is already set. Refresh re-fetches balances,
 *  locks AND history from the store, so the spinner means new on-chain
 *  data, not a timer. */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, shortAddress } from '../../lib/format';
import { AppHeader } from '../../components/AppShell';
import { EmptyState } from '../../components/ui';

export default function History() {
  const { history, allHistory, historyError, showDust, setShowDust, refreshAll } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 768;

  // The store already hides spam in `history` unless showDust is on —
  // the old screen kept its own local toggle over the already-filtered
  // list, so the spam count was always 0 and the toggle never appeared.
  // The count comes from the unfiltered list and the toggle drives the
  // store, so it actually reveals the hidden transfers.
  const list = history;
  const spamCount = allHistory.filter((t) => t.isSpam).length;

  // Real refresh: re-fetches balances, locks AND history from the store
  // (refreshAll), so the spinner means new on-chain data, not a timer.
  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.inner,
        {
          paddingTop: 12 + insets.top,
          paddingBottom: 24 + insets.bottom,
          ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null),
        },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <AppHeader />
      <View style={styles.head}>
        <View style={styles.headSide} />
        <View style={styles.headMid}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            Transaction History
          </Text>
          <Text style={styles.sub}>Live on-chain data</Text>
        </View>
        <Pressable onPress={() => void onRefresh()} style={styles.headSide} hitSlop={8} accessibilityLabel="Refresh history">
          <RefreshCw size={18} color={COLORS.text} />
        </Pressable>
      </View>

      {historyError ? <Text style={styles.error}>{historyError}</Text> : null}

      {list.length === 0 ? (
        <EmptyState title="No transactions yet" body="Sends, receives, swaps and lock events will appear here." />
      ) : (
        list.map((t) => {
          const received = t.kind === 'received' || t.kind === 'autosell' || t.kind === 'unlock';
          const label =
            t.kind === 'received'
              ? 'Token Received'
              : t.kind === 'sent'
                ? 'Token Sent'
                : t.kind === 'swap'
                  ? 'Swap'
                  : t.kind === 'lock'
                    ? 'Locked'
                    : t.kind === 'unlock'
                      ? 'Unlocked'
                      : 'Target hit — auto-sold';
          const party = t.counterparty ? `${received ? 'From' : 'To'} ${shortAddress(t.counterparty, 4)}` : (t.note ?? '');
          const date = t.at > 0 ? new Date(t.at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
          return (
            <Pressable
              key={t.id}
              style={styles.row}
              onPress={() => router.push({ pathname: '/tx/[hash]', params: { hash: t.hash, chainId: t.chainId } })}
            >
              <View style={[styles.icon, received ? styles.iconIn : styles.iconOut]}>
                {received ? <ArrowDown size={18} color={COLORS.mintDark} /> : <ArrowUp size={18} color={COLORS.text} />}
              </View>
              <View style={styles.mid}>
                <Text style={styles.kind}>{label}</Text>
                <Text style={styles.party} numberOfLines={1}>{party}</Text>
              </View>
              <View style={styles.right}>
                <Text
                  style={[styles.amount, { color: received ? COLORS.mintDark : COLORS.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {received ? '+' : '-'}
                  {fmtNum(t.amount, 4)} {t.token}
                </Text>
                <Text style={styles.date}>{date}</Text>
              </View>
            </Pressable>
          );
        })
      )}

      {spamCount > 0 && (
        <Pressable onPress={() => setShowDust(!showDust)}>
          <Text style={styles.spamToggle}>
            {showDust ? 'Hide spam transfers' : `Show spam (${spamCount} hidden)`}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  date: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, textAlign: 'right' },
  error: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 10 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headMid: { alignItems: 'center', flex: 1, minWidth: 0 },
  headSide: { alignItems: 'center', width: 32 },
  inner: { padding: 12 },
  kind: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  icon: { alignItems: 'center', borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  iconIn: { backgroundColor: COLORS.mintSoft },
  iconOut: { backgroundColor: COLORS.bgMuted },
  mid: { flex: 1, minWidth: 0 },
  party: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  spamToggle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 14, textAlign: 'center' },
  sub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
});
