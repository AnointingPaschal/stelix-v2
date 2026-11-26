/** Screen 15 — History: filterable, spam hidden by default, lock events first-class. */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtDateTime, fmtNum, fmtUsd } from '../../lib/format';
import { Btn, Chip, DemoBadge } from '../../components/ui';

type Filter = 'all' | 'sent' | 'received' | 'swap' | 'lock' | 'unlock' | 'autosell';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
  { key: 'swap', label: 'Swaps' },
  { key: 'lock', label: 'Locks' },
  { key: 'unlock', label: 'Unlocks' },
  { key: 'autosell', label: 'Auto-sells' },
];

export default function History() {
  const { history, settings } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showSpam, setShowSpam] = useState(false);

  const list = useMemo(() => {
    return history.filter((t) => {
      if (t.isSpam && !showSpam) return false;
      if (filter === 'all') return true;
      return t.kind === filter;
    });
  }, [history, filter, showSpam]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>History</Text>
        <DemoBadge />
      </View>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Btn
            key={f.key}
            label={f.label}
            variant={filter === f.key ? 'primary' : 'ghost'}
            onPress={() => setFilter(f.key)}
            style={styles.filterBtn}
          />
        ))}
      </View>
      {list.map((t) => (
        <View key={t.id} style={[styles.row, t.isSpam && styles.spamRow]}>
          <View style={styles.mid}>
            <Text style={styles.kind}>
              {t.kind === 'autosell' ? 'Target hit — auto-sold' : t.kind[0].toUpperCase() + t.kind.slice(1)}{' '}
              {fmtNum(t.amount)} {t.token}
            </Text>
            <Text style={styles.note}>{t.note ?? t.counterparty ?? ''}</Text>
            <Text style={styles.date}>{fmtDateTime(t.at)}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.usd}>{fmtUsd(t.usd)}</Text>
            <Chip label={t.status} tone={t.status === 'confirmed' ? 'mint' : t.status === 'pending' ? 'amber' : 'red'} />
          </View>
        </View>
      ))}
      {list.length === 0 && <Text style={styles.empty}>Nothing here yet.</Text>}
      {history.some((t) => t.isSpam) && (
        <Pressable onPress={() => setShowSpam((s) => !s)}>
          <Text style={styles.spamToggle}>
            {showSpam ? 'Hide spam transfers' : `Show spam (${history.filter((t) => t.isSpam).length} hidden)`}
          </Text>
        </Pressable>
      )}
      <Text style={styles.note2}>
        Spam transfers are hidden by default{settings.hideSpam ? '' : ' (spam hiding is off in Settings)'}.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  date: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  empty: { color: COLORS.textMuted, marginTop: 20, textAlign: 'center' },
  filterBtn: { minHeight: 36, paddingHorizontal: 10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 14 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  kind: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  mid: { flex: 1 },
  note: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  note2: { color: COLORS.textMuted, fontSize: 12, marginTop: 16, textAlign: 'center' },
  right: { alignItems: 'flex-end', gap: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  spamRow: { opacity: 0.6 },
  spamToggle: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  usd: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
});
