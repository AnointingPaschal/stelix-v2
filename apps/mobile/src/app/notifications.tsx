/** Screen 16 — Notifications: target progress, maturity, auto-sell,
 *  security alerts.
 *
 *  The list is real: stored notifications from the app plus alerts
 *  derived live from the user's own locks (see lib/notifications.ts) —
 *  maturing/matured locks, 50% / 80% / 100% of target, breached
 *  trailing stops, break cooling-off. "Mark all read" marks both.
 *  Read state for derived items is kept in kv storage. Empty state
 *  only when there is genuinely nothing to report. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtDateTime } from '../lib/format';
import { deriveLockNotifications } from '../lib/notifications';
import { kvGet, kvSet } from '../lib/storage';
import { Btn, EmptyState, centeredContent } from '../components/ui';

const READ_DERIVED_KEY = 'stelix_read_derived_notifications_v1';

interface Row {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  derived: boolean;
}

export default function Notifications() {
  const { notifications, markNotificationsRead, locks, tokens } = useApp();
  const insets = useSafeAreaInsets();

  const [readDerived, setReadDerived] = useState<string[]>([]);

  useEffect(() => {
    void kvGet(READ_DERIVED_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) setReadDerived(parsed);
      } catch {
        // Corrupt read-state: start unread.
      }
    });
  }, []);

  const derived = useMemo(
    () =>
      deriveLockNotifications(
        locks,
        (symbol) => tokens.find((t) => t.symbol === symbol)?.price ?? null,
      ),
    [locks, tokens],
  );

  const rows: Row[] = useMemo(() => {
    const stored: Row[] = notifications.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      at: n.at,
      read: n.read,
      derived: false,
    }));
    const live: Row[] = derived.map((d) => ({
      id: d.id,
      title: d.title,
      body: d.body,
      at: d.at,
      read: readDerived.includes(d.id),
      derived: true,
    }));
    return [...stored, ...live].sort((a, b) => b.at - a.at);
  }, [notifications, derived, readDerived]);

  const unreadCount = rows.filter((r) => !r.read).length;

  const markAllRead = useCallback(() => {
    markNotificationsRead();
    const ids = derived.map((d) => d.id);
    const next = Array.from(new Set([...readDerived, ...ids]));
    setReadDerived(next);
    void kvSet(READ_DERIVED_KEY, JSON.stringify(next));
  }, [markNotificationsRead, derived, readDerived]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
      <Text style={styles.title}>Notifications</Text>
      {rows.length > 0 && unreadCount > 0 ? (
        <Btn label={`Mark all read (${unreadCount})`} variant="ghost" onPress={markAllRead} style={styles.markBtn} />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          body="Target progress, maturity reminders, auto-sell results and security alerts will appear here."
        />
      ) : (
        rows.map((n) => (
          <View key={n.id} style={[styles.row, !n.read && styles.unread]}>
            <View style={styles.icon}>
              <Bell size={16} color={n.read ? COLORS.textMuted : COLORS.mintDark} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.nTitle}>{n.title}</Text>
              <Text style={styles.nBody}>{n.body}</Text>
              <Text style={styles.nDate}>{fmtDateTime(n.at)}</Text>
            </View>
            {!n.read && <View style={styles.dot} />}
          </View>
        ))
      )}
      <Text style={styles.note}>
        Push alerts cover: target at 50% / 80% / 100%, target hit and auto-sell result, trailing-stop
        activation, maturity at 7 days / 1 day / 1 hour, break cooling-off, and security events.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  icon: { alignItems: 'center', backgroundColor: COLORS.bgMuted, borderRadius: 999, height: 36, justifyContent: 'center', width: 36 },
  inner: { padding: 12 },
  markBtn: { alignSelf: 'flex-end', marginVertical: 10, minHeight: 36, paddingHorizontal: 12 },
  mid: { flex: 1 },
  nBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  nDate: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  nTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  note: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'flex-start',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  unread: { backgroundColor: COLORS.mintSoft, borderRadius: 12, marginHorizontal: -8, paddingHorizontal: 8 },
});
