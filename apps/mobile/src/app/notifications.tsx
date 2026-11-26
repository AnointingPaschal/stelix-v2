/** Screen 16 — Notifications: target progress, maturity, auto-sell, security alerts. */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtDateTime } from '../lib/format';
import { Btn, DemoBadge } from '../components/ui';

export default function Notifications() {
  const { notifications, markNotificationsRead } = useApp();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Notifications</Text>
        <DemoBadge />
      </View>
      <Btn label="Mark all read" variant="ghost" onPress={markNotificationsRead} style={styles.markBtn} />
      {notifications.map((n) => (
        <View key={n.id} style={[styles.row, !n.read && styles.unread]}>
          <View style={styles.icon}>
            <Bell size={18} color={n.read ? COLORS.textMuted : COLORS.mintDark} />
          </View>
          <View style={styles.mid}>
            <Text style={styles.nTitle}>{n.title}</Text>
            <Text style={styles.nBody}>{n.body}</Text>
            <Text style={styles.nDate}>{fmtDateTime(n.at)}</Text>
          </View>
          {!n.read && <View style={styles.dot} />}
        </View>
      ))}
      <Text style={styles.note}>
        Push alerts cover: target at 50% / 80% / 100%, target hit and auto-sell result, trailing-stop
        activation, maturity at 7 days / 1 day / 1 hour, break cooling-off, and security events.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 10, width: 10 },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  icon: { alignItems: 'center', backgroundColor: COLORS.bgMuted, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  inner: { padding: 20 },
  markBtn: { alignSelf: 'flex-end', marginVertical: 12, minHeight: 36, paddingHorizontal: 12 },
  mid: { flex: 1 },
  nBody: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  nDate: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  nTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'flex-start',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
  },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  unread: { backgroundColor: COLORS.mintSoft, borderRadius: 12, marginHorizontal: -8, paddingHorizontal: 8 },
});
