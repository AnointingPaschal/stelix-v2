/** Screen 9 — Receive Assets (v1): back + centred title, chain pill,
 *  QR card, Your Public Address box, Copy Address navy button, red warning
 *  box. The address shown is the wallet's stored address — never a
 *  hardcoded one. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { Btn, Card, ScreenHeader, centeredContent } from '../components/ui';

export default function Receive() {
  const { address, chain } = useApp();
  const insets = useSafeAreaInsets();

  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
      <ScreenHeader title="Receive Assets" onBack={() => router.back()} />

      <View style={styles.chainPill}>
        <View style={styles.netDot} />
        <Text style={styles.chainText}>{chain.name}</Text>
      </View>

      {address ? (
        <Card style={styles.qrCard}>
          <QRCode value={address} size={200} color={COLORS.navy} backgroundColor="#fff" />
        </Card>
      ) : (
        <Card style={styles.qrCard}>
          <Text style={styles.noAddr}>No wallet address yet — create or import a wallet first.</Text>
        </Card>
      )}

      <Text style={styles.label}>Your Public Address</Text>
      <View style={styles.addrBox}>
        <Text style={styles.addr} selectable>{address || '—'}</Text>
      </View>
      <Btn label={copied ? 'Copied' : 'Copy Address'} onPress={copy} disabled={!address} />

      <Card style={styles.warn}>
        <Text style={styles.warnTitle}>Send only {chain.name} assets to this address</Text>
        <Text style={styles.warnBody}>
          Sending other assets will result in permanent loss.
          {chain.kind === 'solana'
            ? ' Solana uses base58 addresses — confirm the format matches before sending.'
            : ''}
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addr: { color: COLORS.text, fontSize: 12, textAlign: 'center' },
  addrBox: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    marginTop: 6,
    padding: 12,
  },
  chainPill: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chainText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  inner: { padding: 12 },
  label: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 16 },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  noAddr: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  qrCard: { alignItems: 'center', marginTop: 16, paddingVertical: 20 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  warn: { backgroundColor: COLORS.redSoft, borderColor: '#FECACA', marginTop: 16 },
  warnBody: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 4 },
  warnTitle: { color: COLORS.red, fontSize: 13, fontWeight: '800' },
});
