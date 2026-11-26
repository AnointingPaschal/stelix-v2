/** Screen 8 — Send: locked funds blocked, MAX reserves gas, warnings before signing. */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtNum, fmtUsd } from '../lib/format';
import { isValidEvmAddress } from '../lib/wallet';
import { Btn, Card, Chip, DemoBadge, RiskNote, SectionTitle } from '../components/ui';

export default function Send() {
  const { tokens, chain, addTx } = useApp();
  const spendable = tokens.filter((t) => !t.isSpam);
  const [symbol, setSymbol] = useState('USDT');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState(false);

  const token = spendable.find((t) => t.symbol === symbol) ?? spendable[0];
  const amt = parseFloat(amount) || 0;
  const gasReserveUsd = 0.5;

  function review() {
    if (!isValidEvmAddress(to)) {
      Alert.alert('Invalid address', 'That does not look like a valid address on this chain. Double-check it before sending.');
      return;
    }
    if (amt <= 0) {
      Alert.alert('Enter an amount', 'How much do you want to send?');
      return;
    }
    if (amt > token.balance) {
      Alert.alert(
        'Locked funds cannot be sent',
        `You only have ${fmtNum(token.balance)} ${token.symbol} spendable. ${fmtNum(token.locked)} ${token.symbol} is locked in the vault and cannot be selected.`,
      );
      return;
    }
    Alert.alert(
      'Review send',
      `Send ${fmtNum(amt)} ${token.symbol} (${fmtUsd(amt * token.price)}) to ${to.slice(0, 10)}…${to.slice(-6)} on ${chain.name}.\nNetwork fee ≈ $0.42.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Sign',
          onPress: () => {
            addTx({ id: `tx-${Date.now()}`, kind: 'sent', token: token.symbol, amount: amt, usd: amt * token.price, counterparty: to, at: Date.now(), status: 'confirmed' });
            setSent(true);
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <View style={styles.head}>
        <Text style={styles.title}>Send</Text>
        <DemoBadge />
      </View>
      <Chip label={`${chain.name} · native ${chain.nativeSymbol}`} tone="navy" />

      <SectionTitle title="Asset" />
      <View style={styles.pills}>
        {spendable.map((t) => (
          <Btn key={t.symbol} label={t.symbol} variant={symbol === t.symbol ? 'primary' : 'ghost'} onPress={() => setSymbol(t.symbol)} style={styles.pill} />
        ))}
      </View>

      <SectionTitle title="Recipient" />
      <TextInput
        style={styles.input}
        placeholder="0x... or paste address"
        autoCapitalize="none"
        autoCorrect={false}
        value={to}
        onChangeText={setTo}
      />
      <Text style={styles.hint}>New-address warning: always double-check the first and last characters. Wrong-chain sends may be lost permanently.</Text>

      <SectionTitle title="Amount" />
      <Card>
        <TextInput
          style={styles.amountInput}
          keyboardType="decimal-pad"
          placeholder="0.0"
          value={amount}
          onChangeText={setAmount}
        />
        <Text style={styles.balance}>
          Spendable: {fmtNum(token.balance)} {token.symbol} · Locked: {fmtNum(token.locked)} {token.symbol} (greyed — unavailable)
        </Text>
        <View style={styles.maxRow}>
          <Btn label="25%" variant="ghost" onPress={() => setAmount(String((token.balance * 0.25).toFixed(4)))} style={styles.maxBtn} />
          <Btn label="50%" variant="ghost" onPress={() => setAmount(String((token.balance * 0.5).toFixed(4)))} style={styles.maxBtn} />
          <Btn label="MAX" variant="primary" onPress={() => setAmount(String(Math.max(0, token.balance - gasReserveUsd / token.price).toFixed(4)))} style={styles.maxBtn} />
        </View>
        <Text style={styles.hint}>MAX reserves gas so the transaction can confirm.</Text>
      </Card>

      {sent ? (
        <Card style={styles.done}>
          <Text style={styles.doneTitle}>Sent (DEMO)</Text>
          <Text style={styles.doneBody}>{fmtNum(amt)} {token.symbol} sent. See History for the explorer link.</Text>
          <Btn label="Back to Home" variant="ghost" onPress={() => router.replace('/(tabs)')} />
        </Card>
      ) : (
        <Btn label="Review Send" onPress={review} />
      )}
      <RiskNote />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  amountInput: { fontSize: 26, fontWeight: '800' },
  balance: { color: COLORS.textMuted, fontSize: 13, marginTop: 8 },
  done: { backgroundColor: COLORS.mintSoft, marginTop: 16 },
  doneBody: { color: COLORS.mintDark, fontSize: 14, lineHeight: 20, marginTop: 6 },
  doneTitle: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  inner: { padding: 20 },
  input: { backgroundColor: COLORS.bgMuted, borderRadius: 12, fontSize: 15, marginTop: 8, padding: 14 },
  maxBtn: { flex: 1, minHeight: 40 },
  maxRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pill: { minHeight: 40, paddingHorizontal: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  title: { color: COLORS.text, fontSize: 24, fontWeight: '800' },
});
