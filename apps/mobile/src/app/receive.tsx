/** Screen 9 — Receive: QR + address per chain, wrong-chain warning. */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../theme';
import { useApp, CHAINS } from '../store/AppContext';
import { Btn, Card, Chip, DemoBadge } from '../components/ui';

export default function Receive() {
  const { address, chain, setChain } = useApp();
  const isSolana = chain.kind === 'solana';
  // Solana uses a base58 address, not an EVM address — shown explicitly.
  const displayAddress = isSolana ? '7xKXtg2CW87d97TXJSDpbD5jBkheTqA8b5x8Kq2ZvM9a' : address;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Receive</Text>
        <DemoBadge />
      </View>
      <View style={styles.pills}>
        {CHAINS.map((c) => (
          <Btn key={c.id} label={c.name} variant={chain.id === c.id ? 'primary' : 'ghost'} onPress={() => setChain(c)} style={styles.pill} />
        ))}
      </View>

      <Card style={styles.qrCard}>
        <QRCode value={displayAddress} size={200} color={COLORS.navy} backgroundColor="#fff" />
        <Text style={styles.addr}>{displayAddress}</Text>
        <Btn label="Copy Address" onPress={() => Clipboard.setStringAsync(displayAddress)} />
      </Card>

      <Card style={styles.warn}>
        <Text style={styles.warnTitle}>Send only {chain.name} assets to this address</Text>
        <Text style={styles.warnBody}>
          {isSolana
            ? 'This is a Solana (base58) address. Sending EVM assets here may result in permanent loss.'
            : `Sending other chains' assets to this ${chain.name} address may result in permanent loss.`}
        </Text>
      </Card>
      {chain.testnet && <Chip label="Testnet chain — test funds only" tone="amber" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addr: { color: COLORS.text, fontSize: 12, marginVertical: 16, textAlign: 'center' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inner: { padding: 20 },
  pill: { minHeight: 36, paddingHorizontal: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 16 },
  qrCard: { alignItems: 'center', paddingVertical: 24 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
  warn: { backgroundColor: '#FEF3C7', marginTop: 16 },
  warnBody: { color: '#92400E', fontSize: 13, lineHeight: 19, marginTop: 6 },
  warnTitle: { color: '#92400E', fontSize: 15, fontWeight: '800' },
});
