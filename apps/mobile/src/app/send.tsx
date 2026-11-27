/** Screen 8 — Transfer Assets (v1): back + centred title, chain pill,
 *  Asset selector card, Recipient Address input with paste, Amount with
 *  Bal + MAX, live network-fee estimate. Signing happens ONLY in the
 *  shared SignTransactionModal — there is no password field on this page.
 *  Sends are REAL signed transactions (see lib/send.ts) — the hash is
 *  shown and recorded in History only after the transaction is mined.
 *  EVM chains only; Solana sends are refused honestly (no Solana send
 *  path is wired yet). */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Clipboard as ClipboardIcon } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtNum, fmtUsd } from '../lib/format';
import { isValidEvmAddress } from '../lib/wallet';
import { getSignerForChain } from '../lib/signer';
import { displaySavedAddress, loadAddressBook, type SavedAddress } from '../lib/addressBook';
import { estimateSendFee, sendToken, type SendEstimate, type SendResult } from '../lib/send';
import { BottomSheet, Btn, OptionSheet, RiskNote, ScreenHeader, centeredContent } from '../components/ui';
import { TokenLogo } from '../components/TokenLogo';
import {
  SignTransactionModal,
  type SignTxRequest,
  type SignTxResult,
} from '../components/SignTransactionModal';

export default function Send() {
  const { tokens, chain, address, settings, addTx, refreshBalances } = useApp();
  const insets = useSafeAreaInsets();

  const spendable = tokens.filter((t) => !t.isSpam);
  // Selection is keyed by chain + contract address, not by symbol:
  // two different tokens can share a symbol (e.g. USDC on two chains,
  // or an imported token shadowing a catalogue one), and the old
  // symbol-keyed picker silently picked the first match.
  const tokenKey = (t: { chainId: string; address: string }) => `${t.chainId}:${t.address}`;
  const [selectedKey, setSelectedKey] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedContacts, setSavedContacts] = useState<SavedAddress[]>([]);

  // Saved recipients (Settings → Address Book) — loaded when the
  // picker opens, so the list is always current.
  useEffect(() => {
    if (savedOpen) void loadAddressBook().then(setSavedContacts);
  }, [savedOpen]);
  const [fee, setFee] = useState<SendEstimate | null>(null);
  const [feeError, setFeeError] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState<SendResult | null>(null);
  const [signModal, setSignModal] = useState<SignTxRequest | null>(null);

  const token = spendable.find((t) => tokenKey(t) === selectedKey) ?? spendable[0];
  // Spendable = balance minus what the vault holds. The old check used
  // the full balance (locked was always 0), so its "locked funds"
  // error message was wrong in both directions.
  const spendableBalance = token ? Math.max(0, token.balance - token.locked) : 0;
  const amt = parseFloat(amount) || 0;
  const valid = !!token && amt > 0 && amt <= spendableBalance && isValidEvmAddress(to);

  async function paste() {
    const text = await Clipboard.getStringAsync();
    if (text) setTo(text.trim());
  }

  async function review() {
    if (!token) return;
    setFormError('');
    if (chain.kind !== 'evm') {
      setFormError('Sending is not available on Solana — signed sends are wired for EVM chains only. No transaction was sent.');
      return;
    }
    if (!isValidEvmAddress(to)) {
      setFormError('That does not look like a valid address on this chain. Double-check it before sending.');
      return;
    }
    if (amt <= 0) {
      setFormError('Enter an amount to send.');
      return;
    }
    if (amt > spendableBalance) {
      setFormError(
        token.locked > 0
          ? `You only have ${fmtNum(spendableBalance)} ${token.symbol} spendable — ${fmtNum(token.locked)} ${token.symbol} is locked in the vault and cannot be sent.`
          : `Insufficient balance — you have ${fmtNum(spendableBalance)} ${token.symbol}.`,
      );
      return;
    }
    // Live fee estimate from the chain RPC — shown in the signing modal, never invented.
    setEstimating(true);
    setFeeError('');
    try {
      const native = tokens.find((t) => t.address === '');
      const est = await estimateSendFee(
        { chainId: chain.id, tokenAddress: token.address, tokenSymbol: token.symbol, tokenDecimals: token.decimals, to, amount: amt },
        address,
        native?.price ?? null,
      );
      setFee(est);
      setSignModal({
        title: 'Confirm Send',
        actionLabel: 'Sign & Send',
        fromAddress: address,
        toAddress: to,
        toLabel: 'Recipient',
        network: `${chain.name}${chain.testnet ? ' (testnet)' : ''}`,
        rows: [
          { label: 'You send', value: `${fmtNum(amt)} ${token.symbol}` },
          { label: 'Value', value: token.price === null ? 'Price unavailable' : fmtUsd(amt * token.price) },
          {
            label: 'Network fee (est.)',
            value: `${est.feeNative} ${chain.nativeSymbol}${est.feeUsd !== null ? ` (≈ ${fmtUsd(est.feeUsd)})` : ''}`,
          },
          { label: 'Gas limit', value: est.gasLimit.toString() },
        ],
        warning: 'New-address warning: always double-check the first and last characters. Wrong-chain sends may be lost permanently.',
        explorerBase: chain.explorerUrl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeeError(msg);
      setFormError(`Could not estimate the network fee: ${msg}`);
    } finally {
      setEstimating(false);
    }
  }

  async function signSend(password: string): Promise<SignTxResult> {
    if (!token) throw new Error('No token selected.');
    const signer = await getSignerForChain(password, chain.id);
    const res = await sendToken(signer, {
      chainId: chain.id,
      tokenAddress: token.address,
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
      to,
      amount: amt,
    });
    return { hash: res.hash, blockNumber: res.blockNumber };
  }

  async function onSendSigned(res: SignTxResult) {
    if (!token) return;
    setSent({ hash: res.hash, blockNumber: res.blockNumber ?? null, from: address, to, amountRaw: String(amt) });
    addTx({
      id: res.hash,
      hash: res.hash,
      kind: 'sent',
      token: token.symbol,
      amount: amt,
      amountRaw: String(amt),
      usd: token.price !== null ? amt * token.price : null,
      counterparty: to,
      at: Date.now(),
      status: 'confirmed',
      isSpam: false,
      chainId: chain.id,
      blockNumber: res.blockNumber ?? null,
    });
    await refreshBalances();
  }

  if (spendable.length === 0) {
    return (
      <View style={[styles.root, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 24 + insets.bottom }]}>
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
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}>
        <ScreenHeader title="Transfer Assets" onBack={() => router.back()} />

        <View style={styles.chainPill}>
          <View style={styles.netDot} />
          <Text style={styles.chainText}>
            {chain.name} · Native: {chain.nativeSymbol}
          </Text>
        </View>

        <Text style={styles.label}>Asset</Text>
        <Pressable style={styles.assetCard} onPress={() => setPickerOpen(true)}>
          {token ? (
            <TokenLogo chainId={token.chainId} address={token.address} symbol={token.symbol} size={36} fallbackTone="light" logoUrl={token.logoUrl} />
          ) : (
            <View style={styles.assetAvatar}>
              <Text style={styles.assetAvatarText}>?</Text>
            </View>
          )}
          <View style={styles.assetMid}>
            <Text style={styles.assetName}>{token?.symbol ?? '—'}</Text>
            <Text style={styles.assetSub}>Native Token</Text>
          </View>
          <ChevronDown size={16} color={COLORS.textMuted} />
        </Pressable>

        <View style={styles.recipientHead}>
          <Text style={[styles.label, styles.labelNoTop]}>Recipient Address</Text>
          <Pressable style={styles.savedBtn} onPress={() => setSavedOpen(true)}>
            <Text style={styles.savedText}>Saved</Text>
          </Pressable>
        </View>
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
          <Text style={styles.bal}>Bal: {fmtNum(spendableBalance, 6)} {token?.symbol ?? ''}</Text>
          <Pressable style={styles.maxBtn} onPress={() => token && setAmount(String(spendableBalance))}>
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

        {fee ? (
          <Text style={styles.hint}>
            Estimated network fee: {fee.feeNative} {chain.nativeSymbol}
            {fee.feeUsd !== null ? ` (≈ ${fmtUsd(fee.feeUsd)})` : ''} · gas limit {fee.gasLimit.toString()}
          </Text>
        ) : null}
        {feeError ? <Text style={styles.feeError}>{feeError}</Text> : null}
        {formError ? <Text style={styles.feeError}>{formError}</Text> : null}
        {sent ? (
          <Text style={styles.sentLine}>
            Sent — tx {sent.hash.slice(0, 12)}…{sent.hash.slice(-6)}
            {sent.blockNumber !== null ? ` · block ${sent.blockNumber}` : ''}. Recorded in History.
          </Text>
        ) : null}

        <View style={styles.spacer} />
        <Btn
          label={estimating ? 'Estimating fee…' : 'Review Transaction'}
          variant={valid ? 'primary' : 'secondary'}
          onPress={() => void review()}
          disabled={!valid || estimating}
        />
        <RiskNote />

        <SignTransactionModal
          visible={signModal !== null}
          request={signModal}
          biometricsEnabled={settings.biometrics}
          onClose={() => setSignModal(null)}
          onSign={signSend}
          onSigned={(res) => void onSendSigned(res)}
        />

        <OptionSheet
          visible={savedOpen}
          onClose={() => setSavedOpen(false)}
          title="Saved Recipients"
          options={savedContacts.map((c) => ({
            key: c.address,
            label: c.label,
            sub: `${displaySavedAddress(c.address)} · ${c.kind === 'evm' ? 'EVM' : 'Solana'}`,
          }))}
          onSelect={(key) => setTo(key)}
        />

        <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Select Asset">
          {spendable.map((t) => (
            <Pressable
              key={tokenKey(t)}
              style={styles.pickRow}
              onPress={() => {
                setSelectedKey(tokenKey(t));
                setPickerOpen(false);
              }}
            >
              <TokenLogo chainId={t.chainId} address={t.address} symbol={t.symbol} size={36} fallbackTone="light" logoUrl={t.logoUrl} />
              <View style={styles.assetMid}>
                <Text style={styles.assetName}>{t.symbol}</Text>
                <Text style={styles.assetSub}>{t.name}</Text>
              </View>
              <Text style={styles.pickBal}>{fmtNum(t.balance, 4)}</Text>
            </Pressable>
          ))}
        </BottomSheet>
      </ScrollView>
    </KeyboardAvoidingView>
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
  amountHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
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
  feeError: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 6 },
  sentLine: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 8 },
  inner: { padding: 12 },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 14 },
  labelNoTop: { marginTop: 0 },
  maxBtn: { backgroundColor: COLORS.navy, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  maxText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  pickBal: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  pickRow: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  recipientHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  savedBtn: { backgroundColor: COLORS.bgMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  savedText: { color: COLORS.navy, fontSize: 12, fontWeight: '800' },
  spacer: { flex: 1, minHeight: 24 },
});
