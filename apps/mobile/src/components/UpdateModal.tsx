/**
 * UpdateModal — a new version of Stelix is available.
 *
 * Centred modal: the version, the release notes, an Update button that
 * opens the download link, and a Later button that dismisses (hidden
 * when the release is forced). The copy says nothing about the admin,
 * the sync, or how the release was published — just that a new version
 * of Stelix is available.
 */
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpCircle } from 'lucide-react-native';
import { COLORS, FONT, RADIUS, SHADOW } from '../theme';
import { Btn } from './ui';
import type { AppUpdate } from '../lib/appUpdate';

export default function UpdateModal({
  update,
  onDismiss,
}: {
  update: AppUpdate | null;
  onDismiss: () => void;
}) {
  if (!update) return null;
  const openUpdate = () => {
    if (update.url) void Linking.openURL(update.url);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={update.force ? undefined : onDismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.icon}>
            <ArrowUpCircle size={36} color={COLORS.mintDark} />
          </View>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.version}>Stelix v{update.version}</Text>
          {update.notes ? <Text style={styles.notes}>{update.notes}</Text> : null}
          {update.url ? (
            <Btn label="Update" variant="mint" onPress={openUpdate} style={styles.updateBtn} />
          ) : null}
          {!update.force ? (
            <Btn label="Later" variant="ghost" onPress={onDismiss} style={styles.laterBtn} />
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 18, 32, 0.55)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: '100%',
    ...SHADOW.card,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: COLORS.mintSoft,
    borderColor: '#A7F3D0',
    borderRadius: 999,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  title: { color: COLORS.navy, fontSize: FONT.screenTitle, fontWeight: '800', marginTop: 16, textAlign: 'center' },
  version: { color: COLORS.textMuted, fontSize: FONT.body, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  notes: { color: COLORS.text, fontSize: FONT.body, lineHeight: 21, marginTop: 12, textAlign: 'center' },
  updateBtn: { marginTop: 20, width: '100%' },
  laterBtn: { marginTop: 10, width: '100%' },
});
