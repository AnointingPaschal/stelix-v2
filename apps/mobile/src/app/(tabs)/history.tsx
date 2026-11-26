/** Screen 15 — Transaction History (v1, via Ankr): centred title + "via
 *  Ankr" sub, refresh icon. Mint down-circle for Token Received, grey
 *  up-circle for Token Sent, amount right-aligned, date below. Spam hidden
 *  by default. Empty state: "No transactions yet". */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, shortAddress } from '../../lib/format';
import { EmptyState } from '../../components/ui';

export default function History() {
  const { history } = useApp();
  const [showSpam, setShowSpam] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const list = history.filter((t) => !t.isSpam || showSpam);
  const spamCount = history.filter((t) => t.isSpam).length;

  function onRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 900);
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.head}>
        <View style={styles.headSide} />
        <View style={styles.headMid}>
          <Text style={styles.title}>Transaction History</Text>
          <Text style={styles.sub}>via Ankr</Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.headSide} hitSlop={8}>
          <RefreshCw size={18} color={COLORS.text} />
        </Pressable>
      </View>

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
          const date = new Date(t.at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          return (
            <View key={t.id} style={styles.row}>
              <View style={[styles.icon, received ? styles.iconIn : styles.iconOut]}>
                {received ? <ArrowDown size={18} color={COLORS.mintDark} /> : <ArrowUp size={18} color={COLORS.text} />}
              </View>
              <View style={styles.mid}>
                <Text style={styles.kind}>{label}</Text>
                <Text style={styles.party} numberOfLines={1}>{party}</Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.amount, { color: received ? COLORS.mintDark : COLORS.text }]}>
                  {received ? '+' : '-'}
                  {fmtNum(t.amount, 4)} {t.token}
                </Text>
                <Text style={styles.date}>{date}</Text>
              </View>
            </View>
          );
        })
      )}

      {spamCount > 0 && (
        <Pressable onPress={() => setShowSpam((s) => !s)}>
          <Text style={styles.spamToggle}>
            {showSpam ? 'Hide spam transfers' : `Show spam (${spamCount} hidden)`}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  date: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, textAlign: 'right' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headMid: { alignItems: 'center', flex: 1 },
  headSide: { alignItems: 'center', width: 32 },
  inner: { padding: 12 },
  kind: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  icon: { alignItems: 'center', borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  iconIn: { backgroundColor: COLORS.mintSoft },
  iconOut: { backgroundColor: COLORS.bgMuted },
  mid: { flex: 1 },
  party: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end' },
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
