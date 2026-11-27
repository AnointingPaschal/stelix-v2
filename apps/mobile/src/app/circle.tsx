/**
 * Screen — Circle wallet on Arc (User-Controlled Wallet, MPC).
 *
 * EOA on Arc testnet first. No seed phrase: the user approves every
 * transaction in the Circle PIN UI. Circle works ONLY in the EAS
 * release / dev build — NOT in Expo Go — and only once a Circle App ID
 * is configured and the admin Worker endpoints are live. Until then
 * this screen says so honestly and creates nothing: no fake wallet,
 * no fake balance.
 *
 * Balance is read LIVE from the Arc RPC (existing fetchBalances) —
 * never stored, never invented. SCA / Gas Station are not built yet.
 * Circle UCW alone cannot auto-sell; auto-sell needs StelixVault +
 * keeper (see the Vault screen).
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck, Wallet as WalletIcon } from 'lucide-react-native';
import { COLORS } from '../theme';
import { useCircleWallet } from '../store/CircleWalletContext';
import { getChain } from '../lib/chains';
import { fetchBalances, type TokenBalance } from '../lib/balances';
import { isValidEvmAddress } from '../lib/wallet';
import { fmtNum, fmtUsd } from '../lib/format';
import { Btn, Card, Chip, EmptyState, RiskNote, ScreenHeader, centeredContent } from '../components/ui';

export default function CircleWalletScreen() {
  const insets = useSafeAreaInsets();
  const circle = useCircleWallet();
  const [usdc, setUsdc] = useState<TokenBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const address = circle.activeWallet?.address ?? '';
  const arc = getChain('arc');

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      const res = await fetchBalances('arc', address, []);
      // Arc's native gas asset IS USDC (6 decimals) — the native row.
      const native = res.tokens.find((t) => t.address === '') ?? res.tokens.find((t) => t.symbol === 'USDC') ?? null;
      setUsdc(native);
      if (res.error) setBalanceError(res.error);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : 'Could not load the Arc balance.');
    } finally {
      setLoadingBalance(false);
    }
  }, [address]);

  useEffect(() => {
    // No address = no Circle wallet: the balance card is hidden in
    // that state, so there is nothing stale to clear here.
    if (!address) return;
    void (async () => {
      await refreshBalance();
    })();
  }, [address, refreshBalance]);

  async function handleCreateWallet() {
    setLocalError(null);
    try {
      await circle.createWallet();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Circle wallet creation failed.');
    }
  }

  async function handleSetupPin() {
    setLocalError(null);
    try {
      await circle.setupPin();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'PIN setup failed.');
    }
  }

  async function handleSend() {
    setSendError('');
    setSentHash(null);
    if (!isValidEvmAddress(to)) {
      setSendError('That does not look like a valid recipient address.');
      return;
    }
    const amt = parseFloat(amount);
    if (!(amt > 0)) {
      setSendError('Enter an amount greater than 0.');
      return;
    }
    if (usdc && amt > usdc.balance) {
      setSendError(`Insufficient balance — you have ${fmtNum(usdc.balance)} USDC on Arc.`);
      return;
    }
    try {
      const hash = await circle.sendUsdc(to.trim(), amt);
      setSentHash(hash);
      setTo('');
      setAmount('');
      await refreshBalance();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Circle send failed. No transaction was sent.');
    }
  }

  const statusTone = circle.ready ? 'mint' : circle.status === 'checking' ? 'muted' : 'amber';
  const statusLabel =
    circle.status === 'ready'
      ? 'Ready'
      : circle.status === 'checking'
        ? 'Checking…'
        : circle.status === 'expo-go'
          ? 'EAS build only'
          : circle.status === 'web'
            ? 'Not on web'
            : circle.status === 'not-configured'
              ? 'Not set up'
              : 'SDK missing';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.inner, centeredContent, { paddingTop: 12 + insets.top, paddingBottom: 32 + insets.bottom }]}
      >
        <ScreenHeader title="Circle Wallet" sub="Arc · No seed phrase" onBack={() => router.back()} />
        <View style={styles.gap} />

        <Card>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <ShieldCheck size={18} color={COLORS.mintDark} />
            </View>
            <View style={styles.rowMid}>
              <Text style={styles.cardTitle}>Circle User-Controlled Wallet</Text>
              <Text style={styles.cardBody}>
                Non-custodial MPC wallet on Arc. You approve every transaction with your Circle PIN — there is no seed
                phrase to back up or lose.
              </Text>
            </View>
            <Chip label={statusLabel} tone={statusTone} />
          </View>
          <Text style={styles.status}>{circle.statusMessage}</Text>
          {circle.backendConfigured === false ? (
            <Text style={styles.warn}>The admin backend reports Circle is not configured yet.</Text>
          ) : null}
          {circle.backendConfigured === true ? (
            <Text style={styles.ok}>The admin backend reports Circle is configured.</Text>
          ) : null}
        </Card>

        <Card>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <WalletIcon size={18} color={COLORS.mintDark} />
            </View>
            <View style={styles.rowMid}>
              <Text style={styles.cardTitle}>Arc wallet · Testnet first</Text>
              <Text style={styles.cardBody}>
                EOA wallet on Arc Testnet (chain 5042002). Gas is USDC. Smart contract accounts (SCA) and Gas Station
                are not built yet.
              </Text>
            </View>
          </View>
          {!circle.ready ? (
            <EmptyState
              title="Circle is not available here"
              body={circle.statusMessage}
              actionLabel="Check again"
              onAction={() => void circle.refreshStatus()}
            />
          ) : !circle.activeWallet ? (
            <View>
              <Text style={styles.body}>No Circle wallet on this device yet.</Text>
              <View style={styles.gap} />
              <Btn label={circle.busy ? 'Working…' : 'Create Arc Wallet'} onPress={handleCreateWallet} disabled={circle.busy} loading={circle.busy} />
              <View style={styles.gap} />
              <Btn label="Set Circle PIN" variant="ghost" onPress={handleSetupPin} disabled={circle.busy} />
              <Text style={styles.hint}>Creating a wallet opens the Circle PIN setup — set your PIN first if asked.</Text>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>WALLET ADDRESS</Text>
              <Text style={styles.address} selectable>{address}</Text>
              <Text style={styles.label}>USDC BALANCE · ARC TESTNET</Text>
              {loadingBalance ? (
                <Text style={styles.balance}>Loading…</Text>
              ) : usdc ? (
                <Text style={styles.balance}>{fmtNum(usdc.balance)} USDC</Text>
              ) : (
                <Text style={styles.balance}>—</Text>
              )}
              {balanceError ? <Text style={styles.warn}>{balanceError}</Text> : null}
              {usdc && usdc.priceUsd !== null ? (
                <Text style={styles.hint}>{fmtUsd(usdc.balance * usdc.priceUsd)} · live Arc RPC balance</Text>
              ) : (
                <Text style={styles.hint}>Live Arc RPC balance — no price available, so no USD total is shown.</Text>
              )}
              <View style={styles.gap} />
              <Btn label="Refresh Balance" variant="ghost" onPress={() => void refreshBalance()} disabled={loadingBalance} />
              <View style={styles.gap} />
              <Btn label="Set / Change Circle PIN" variant="ghost" onPress={handleSetupPin} disabled={circle.busy} />
            </View>
          )}
          {localError ? <Text style={styles.warn}>{localError}</Text> : null}
          {circle.error ? <Text style={styles.warn}>{circle.error}</Text> : null}
        </Card>

        {circle.ready && circle.activeWallet ? (
          <Card>
            <Text style={styles.cardTitle}>Send USDC on Arc</Text>
            <Text style={styles.cardBody}>
              Sends from your Circle wallet. You approve the transfer in the Circle PIN UI — nothing is sent until you
              approve it there.
            </Text>
            <Text style={styles.label}>RECIPIENT ADDRESS</Text>
            <TextInput
              style={styles.input}
              value={to}
              onChangeText={setTo}
              placeholder="0x…"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>AMOUNT (USDC)</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="decimal-pad"
            />
            {usdc ? <Text style={styles.hint}>Available: {fmtNum(usdc.balance)} USDC</Text> : null}
            {sendError ? <Text style={styles.warn}>{sendError}</Text> : null}
            {sentHash ? (
              <Text style={styles.ok}>Sent. Tx: {sentHash.slice(0, 12)}…{sentHash.slice(-6)}</Text>
            ) : null}
            <View style={styles.gap} />
            <Btn
              label={circle.busy ? 'Waiting for Circle approval…' : 'Send via Circle'}
              onPress={handleSend}
              disabled={circle.busy || !to || !amount}
              loading={circle.busy}
            />
          </Card>
        ) : null}

        <Card>
          <Text style={styles.cardTitle}>What Circle cannot do</Text>
          <Text style={styles.cardBody}>
            Circle alone cannot auto-sell. A price-target auto-sell needs a StelixVault lock on Arc plus the keeper —
            the vault is not deployed on Arc yet, so locks via Circle are unavailable until it is. Vault locks still
            refuse honestly on the Vault screen until then.
          </Text>
          <Text style={styles.cardBody}>Network: {arc.name} · {arc.explorerUrl}</Text>
        </Card>

        <RiskNote text="Circle wallets are non-custodial: Stelix cannot recover your PIN. Crypto prices can fall as well as rise. Only send funds you understand the risks of holding." />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  address: { color: COLORS.text, fontSize: 12, marginTop: 4 },
  balance: { color: COLORS.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  cardBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  cardTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  gap: { height: 10 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.mintSoft,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  inner: { padding: 16 },
  input: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 12 },
  ok: { color: COLORS.mintDark, fontSize: 12, lineHeight: 17, marginTop: 8 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  rowMid: { flex: 1 },
  status: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  warn: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 8 },
});
