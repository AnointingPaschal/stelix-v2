/** Screen 8 — Transfer Assets (v1): back + centred title, chain pill,
 *  Asset selector card, Recipient Address input with paste, Amount with
 *  Bal + MAX, grey "Review Transaction" button until valid. Locked funds
 *  can never be sent. No invented network fee. */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronDown, Clipboard as ClipboardIcon } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtNum, fmtUsd } from '../lib/format';
import { isValidEvmAddress } from '../lib/wallet';
import { BottomSheet, Btn, RiskNote, ScreenHeader } from '../components/ui';

export default function Send() {
  const { tokens, chain } = useApp();
  const spendable = tokens.filter((t) => !t.isSpam);
  const [symbol, setSymbol] = useState(chain.nativeSymbol);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const token = spendable.find((t) => t.symbol === symbol) ?? spendable[0];
  const amt = parseFloat(amount) || 0;
  const valid = !!token && amt > 0 && amt <= token.balance && isValidEvmAddress(to);

  async function paste() {
    const text = await Clipboard.getStringAsync();
    if (text) setTo(text.trim());
  }

  function review() {
    if (!token) return;
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
      'Review Transaction',
      `Send ${fmtNum(amt)} ${token.symbol} (${token.price === null ? 'price unavailable' : fmtUsd(amt * token.price)}) to ${to.slice(0, 10)}…${to.slice(-6)} on ${chain.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Sign',
          onPress: () => {
            // Sending is NOT wired yet (no signed-transfer flow in the
            // wallet layer) — never record a transfer that was not sent.
            Alert.alert(
              'Sending is not wired yet',
              'The signed-transfer flow is not built yet, so no transaction was sent and nothing was recorded in History.',
            );
          },
        },
      ],
    );
  }

  if (spendable.length === 0) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Transfer Assets" onBack={() => router.back()} />
        <View style={styles.inner}>
          <Text style={styles.emptyTitle}>Nothing to send yet</Text>
          <Text style={styles.emptyBody}>You have no tokens on {chain.name}. Receive funds first.</Text>
          <Btn label="Back to Home" variant="ghost" onPress={() => router.replace('/(tabs)')} style={styles.emptyBtn} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <ScreenHeader title="Transfer Assets" onBack={() => router.back()} />

      <View style={styles.chainPill}>
        <View style={styles.netDot} />
        <Text style={styles.chainText}>
          {chain.name} · Native: {chain.nativeSymbol}
        </Text>
      </View>

      <Text style={styles.label}>Asset</Text>
      <Pressable style={styles.assetCard} onPress={() => setPickerOpen(true)}>
        <View style={styles.assetAvatar}>
          <Text style={styles.assetAvatarText}>{(token?.symbol ?? '?').slice(0, 1)}</Text>
        </View>
        <View style={styles.assetMid}>
          <Text style={styles.assetName}>{token?.symbol ?? '—'}</Text>
          <Text style={styles.assetSub}>Native Token</Text>
        </View>
        <ChevronDown size={16} color={COLORS.textMuted} />
      </Pressable>

      <Text style={styles.label}>Recipient Address</Text>
      <View style={styles.addrWrap}>
        <TextInput
          style={styles.addrInput}
          placeholder="0x…"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={to}
          onChangeText={setTo}
        />
        <Pressable onPress={paste} hitSlop={8}>
          <ClipboardIcon size={18} color={COLORS.text} />
        </Pressable>
      </View>
      <Text style={styles.hint}>New-address warning: always double-check the first and last characters. Wrong-chain sends may be lost permanently.</Text>

      <View style={styles.amountHead}>
        <Text style={styles.label}>Amount</Text>
        <Text style={styles.bal}>Bal: {fmtNum(token?.balance ?? 0, 6)} {token?.symbol ?? ''}</Text>
        <Pressable style={styles.maxBtn} onPress={() => token && setAmount(String(token.balance))}>
          <Text style={styles.maxText}>MAX</Text>
        </Pressable>
      </View>
      <View style={styles.amountCard}>
        <TextInput
          style={styles.amountInput}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#CBD5E1"
          value={amount}
          onChangeText={setAmount}
        />
        <Text style={styles.amountSym}>{token?.symbol ?? ''}</Text>
      </View>
      {token && token.locked > 0 ? (
        <Text style={styles.hint}>{fmtNum(token.locked)} {token.symbol} is locked in the vault and unavailable.</Text>
      ) : null}

      <View style={styles.spacer} />
      <Btn
        label="Review Transaction"
        variant={valid ? 'primary' : 'secondary'}
        onPress={review}
        disabled={!valid}
      />
      <Text style={styles.notWired}>Sending is not wired yet — review works, but no transaction is sent from this build.</Text>
      <RiskNote />

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Select Asset">
        {spendable.map((t) => (
          <Pressable
            key={t.symbol}
            style={styles.pickRow}
            onPress={() => {
              setSymbol(t.symbol);
              setPickerOpen(false);
            }}
          >
            <View style={styles.assetAvatar}>
              <Text style={styles.assetAvatarText}>{t.symbol.slice(0, 1)}</Text>
            </View>
            <View style={styles.assetMid}>
              <Text style={styles.assetName}>{t.symbol}</Text>
              <Text style={styles.assetSub}>{t.name}</Text>
            </View>
            <Text style={styles.pickBal}>{fmtNum(t.balance, 4)}</Text>
          </Pressable>
        ))}
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addrInput: { flex: 1, fontSize: 14 },
  addrWrap: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  amountCard: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  amountHead: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800' },
  amountSym: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  assetAvatar: {
    alignItems: 'center',
    backgroundColor: COLORS.bgMuted,
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  assetAvatarText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  assetCard: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    padding: 12,
  },
  assetMid: { flex: 1 },
  assetName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  assetSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  bal: { color: COLORS.textMuted, fontSize: 12, marginLeft: 'auto' },
  chainPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
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
  emptyBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  emptyBtn: { marginTop: 16 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  notWired: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: 'center' },
  inner: { padding: 12 },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 14 },
  maxBtn: { backgroundColor: COLORS.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  maxText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  pickBal: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  spacer: { flex: 1, minHeight: 24 },
});
