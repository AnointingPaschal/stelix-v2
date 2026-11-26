/** Screen 16 — Notifications: target progress, maturity, auto-sell,
 *  security alerts. Empty state when there is nothing yet. */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtDateTime } from '../lib/format';
import { Btn, EmptyState } from '../components/ui';

export default function Notifications() {
  const { notifications, markNotificationsRead } = useApp();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <Text style={styles.title}>Notifications</Text>
      {notifications.length > 0 ? (
        <Btn label="Mark all read" variant="ghost" onPress={markNotificationsRead} style={styles.markBtn} />
      ) : null}
      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          body="Target progress, maturity reminders, auto-sell results and security alerts will appear here."
        />
      ) : (
        notifications.map((n) => (
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
