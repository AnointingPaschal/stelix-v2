/**
 * MaintenanceScreen — shown instead of the whole wallet while the admin
 * has Maintenance Mode on with scope 'all'. The admin's message is shown
 * verbatim; nothing on-chain can be reached from here. "Check again"
 * re-polls the admin sync immediately.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wrench } from 'lucide-react-native';
import { COLORS } from '../theme';
import { Btn } from './ui';
import { useApp } from '../store/AppContext';

export default function MaintenanceScreen() {
  const insets = useSafeAreaInsets();
  const { maintenance, refreshAdmin } = useApp();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.icon}>
        <Wrench size={40} color={COLORS.navy} />
      </View>
      <Text style={styles.title}>Stelix is under maintenance</Text>
      <Text style={styles.message}>
        {maintenance.message !== '' ? maintenance.message : 'The app is temporarily unavailable while maintenance is in progress. Please check back shortly.'}
      </Text>
      <Text style={styles.note}>Sending, swapping and locking are paused. No transaction can be signed while maintenance is on.</Text>
      <Btn label="Check again" onPress={() => void refreshAdmin()} style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderRadius: 999,
    borderWidth: 1,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  title: { color: COLORS.navy, fontSize: 20, fontWeight: '800', marginTop: 20, textAlign: 'center' },
  message: { color: COLORS.text, fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  note: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  btn: { marginTop: 24, minWidth: 180 },
});
