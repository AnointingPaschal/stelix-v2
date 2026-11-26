/** Launch detail — live progress, contributors, and the contributor /
 *  seller actions: contribute (during the sale), finalize (after it ends),
 *  claim (successful sale), refund (failed sale), withdraw raised (seller,
 *  successful sale). Every write asks for the session password and signs
 *  with the existing wallet; gas is USDC, no Stelix fee. */
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, FONT } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtDateTime, fmtNum, fmtPrice, fmtUsd, shortAddress } from '../../lib/format';
import { getSignerForChain } from '../../lib/signer';
import { getProvider } from '../../lib/balances';
import {
  LAUNCHPAD_FREE_NOTE,
  claimOnChain,
  contributeOnChain,
  finalizeOnChain,
  getLaunchpadContract,
  launchActions,
  launchPhase,
  launchPhaseLabel,
  liquidityLockLabel,
  microUsdcToUsd,
  progressBps,
  readLaunchOnChain,
  refundOnChain,
  tokensForContribution,
  withdrawRaisedOnChain,
  type LaunchSale,
} from '../../lib/launchpad';
import { getLaunchpadDeploymentStatus } from '../../lib/chains';
import { Btn, Card, Chip, EmptyState, ProgressBar, RiskNote, ScreenHeader, SectionTitle } from '../../components/ui';
import { TokenLogo } from '../../components/TokenLogo';

export default function LaunchDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const saleId = parseInt(id ?? '', 10);
  const { chain, address } = useApp();
  const status = getLaunchpadDeploymentStatus(chain.id);
  const [sale, setSale] = useState<LaunchSale | null>(null);
  const [liquidityManager, setLiquidityManager] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    if (!Number.isFinite(saleId) || !status.deployed) { setLoading(false); return; }
    setError(null);
    try {
      const s = await readLaunchOnChain(chain.id, saleId, address || undefined);
      setSale(s);
      try {
        const manager = String(await getLaunchpadContract(chain.id, getProvider(chain)).liquidityManager());
        setLiquidityManager(/^0x0+$/.test(manager) ? null : manager);
      } catch {
        setLiquidityManager(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [saleId, status.deployed, chain.id, address]);

  useEffect(() => { void load(); }, [load]);

  async function act(label: string, fn: (signer: Awaited<ReturnType<typeof getSignerForChain>>) => Promise<string | { txHash: string }>) {
    if (!sale) return;
    if (password.length < 8) {
      Alert.alert('Session password required', 'Enter your session password to sign this transaction.');
      return;
    }
    setBusy(true);
    setDone('');
    try {
      const signer = await getSignerForChain(password, chain.id);
      const res = await fn(signer);
      const txHash = typeof res === 'string' ? res : res.txHash;
      setPassword('');
      setDone(`${label} confirmed on-chain (tx ${shortAddress(txHash, 8)}).`);
      await load();
    } catch (e) {
      Alert.alert(`${label} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!Number.isFinite(saleId)) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <ScreenHeader title="Launch" onBack={() => router.back()} />
        <EmptyState title="Launch not found" body="This launch link is missing its sale ID." />
      </ScrollView>
    );
  }

  if (!status.deployed) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <ScreenHeader title="Launch" onBack={() => router.back()} />
        <EmptyState
          title="No launches yet"
          body="No launches yet — launches go live once the launchpad contracts are deployed on Arc testnet"
          actionLabel="Back to Launchpad"
          onAction={() => router.replace('/(tabs)/launchpad')}
        />
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <ScreenHeader title={`Sale #${saleId}`} onBack={() => router.back()} />
        <Text style={styles.note}>Loading sale…</Text>
      </ScrollView>
    );
  }

  if (error || !sale) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <ScreenHeader title={`Sale #${saleId}`} onBack={() => router.back()} />
        <EmptyState title="Sale not found" body={error ?? 'This sale does not exist on the launchpad contract yet.'} actionLabel="Refresh" onAction={() => { setLoading(true); void load(); }} />
      </ScrollView>
    );
  }

  const phase = launchPhase(sale);
  const actions = launchActions(sale);
  const pct = progressBps(sale.raised, sale.hardCap);
  const amt = parseFloat(amount) || 0;
  const tokensBought = tokensForContribution(amt, sale.pricePerToken, sale.tokenDecimals);
  const tokensBoughtWhole = Number(tokensBought) / 10 ** sale.tokenDecimals;
  const myTokensOwed = tokensForContribution(microUsdcToUsd(sale.myContribution), sale.pricePerToken, sale.tokenDecimals);
  const isSeller = !!address && address.toLowerCase() === sale.seller.toLowerCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <ScreenHeader title={`Sale #${sale.saleId}`} sub={sale.tokenName || sale.tokenSymbol} onBack={() => router.back()} />

      <Card style={styles.card}>
        <View style={styles.row}>
          <TokenLogo chainId="arc" address={sale.token} symbol={sale.tokenSymbol || 'T'} size={44} logoUrl={sale.logoUrl} />
          <View style={styles.rowBody}>
            <Text style={styles.symbol}>{sale.tokenSymbol || shortAddress(sale.token)}</Text>
            <Text style={styles.name}>{sale.tokenName || shortAddress(sale.token)}</Text>
          </View>
          <Chip label={launchPhaseLabel(phase)} tone={phase === 'active' ? 'mint' : phase === 'success' ? 'navy' : phase === 'failed' ? 'red' : 'amber'} />
        </View>
        <View style={styles.stats}>
          <View>
            <Text style={styles.label}>Price</Text>
            <Text style={styles.value}>{fmtPrice(microUsdcToUsd(sale.pricePerToken))}</Text>
          </View>
          <View>
            <Text style={styles.label}>Raised</Text>
            <Text style={styles.value}>{fmtUsd(microUsdcToUsd(sale.raised))}</Text>
          </View>
          <View>
            <Text style={styles.label}>Backers</Text>
            <Text style={styles.value}>{sale.contributors}</Text>
          </View>
        </View>
        <ProgressBar value={pct / 10000} />
        <Text style={styles.meta}>
          {fmtUsd(microUsdcToUsd(sale.raised))} of {fmtUsd(microUsdcToUsd(sale.hardCap))} hard cap · Soft cap {fmtUsd(microUsdcToUsd(sale.softCap))}
        </Text>
        <Text style={styles.meta}>
          {fmtNum(Number(sale.tokensSold) / 10 ** sale.tokenDecimals, 2)} of {fmtNum(Number(sale.tokensForSale) / 10 ** sale.tokenDecimals, 2)} tokens sold
        </Text>
        <Text style={styles.meta}>
          {fmtDateTime(sale.startTime * 1000)} → {fmtDateTime(sale.endTime * 1000)}
        </Text>
        <Text style={styles.meta}>Seller {shortAddress(sale.seller)}</Text>
        <Text style={styles.meta}>{liquidityLockLabel(sale, liquidityManager)}</Text>
      </Card>

      {sale.myContribution > 0n && (
        <Card style={styles.card}>
          <SectionTitle title="Your position" />
          <Text style={styles.meta}>Contributed {fmtUsd(microUsdcToUsd(sale.myContribution))}</Text>
          <Text style={styles.meta}>
            Tokens owed {fmtNum(Number(myTokensOwed) / 10 ** sale.tokenDecimals, 4)} {sale.tokenSymbol}
            {sale.claimed ? ' · claimed' : ''}
            {sale.refunded ? ' · refunded' : ''}
          </Text>
        </Card>
      )}

      {actions.canContribute && (
        <Card style={styles.card}>
          <SectionTitle title="Contribute (USDC)" />
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount in USDC, e.g. 25"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="decimal-pad"
          />
          {amt > 0 && (
            <Text style={styles.meta}>You receive ~{fmtNum(tokensBoughtWhole, 4)} {sale.tokenSymbol} at {fmtPrice(microUsdcToUsd(sale.pricePerToken))}.</Text>
          )}
          <Text style={styles.note}>{LAUNCHPAD_FREE_NOTE} — you pay gas in USDC only.</Text>
          <FieldPassword password={password} setPassword={setPassword} />
          <Btn
            label={busy ? 'Contributing…' : 'Contribute'}
            onPress={() => void act('Contribution', async (signer) => contributeOnChain(signer, chain.id, sale.saleId, amt))}
            loading={busy}
            disabled={amt <= 0}
            style={styles.cta}
          />
        </Card>
      )}

      {(actions.canFinalize || actions.canClaim || actions.canRefund || (isSeller && phase === 'success' && !sale.raisedWithdrawn)) && (
        <Card style={styles.card}>
          <SectionTitle title="Settle the sale" />
          <FieldPassword password={password} setPassword={setPassword} />
          {actions.canFinalize && (
            <Btn label={busy ? 'Finalizing…' : 'Finalize sale'} onPress={() => void act('Finalize', async (signer) => finalizeOnChain(signer, chain.id, sale.saleId))} loading={busy} style={styles.cta} />
          )}
          {actions.canClaim && (
            <Btn label={busy ? 'Claiming…' : `Claim ${fmtNum(Number(myTokensOwed) / 10 ** sale.tokenDecimals, 4)} ${sale.tokenSymbol}`} variant="mint" onPress={() => void act('Claim', async (signer) => claimOnChain(signer, chain.id, sale.saleId))} loading={busy} style={styles.cta} />
          )}
          {actions.canRefund && (
            <Btn label={busy ? 'Refunding…' : `Refund ${fmtUsd(microUsdcToUsd(sale.myContribution))}`} variant="mint" onPress={() => void act('Refund', async (signer) => refundOnChain(signer, chain.id, sale.saleId))} loading={busy} style={styles.cta} />
          )}
          {isSeller && phase === 'success' && !sale.raisedWithdrawn && (
            <Btn label={busy ? 'Withdrawing…' : `Withdraw raised (${fmtUsd(microUsdcToUsd(sale.raised - sale.liquidityReserveStable))})`} variant="secondary" onPress={() => void act('Withdraw raised', async (signer) => withdrawRaisedOnChain(signer, chain.id, sale.saleId))} loading={busy} style={styles.cta} />
          )}
          <Text style={styles.note}>
            Seller withdraws the raised funds minus the liquidity reserve. The reserve itself can only go to a liquidity manager — none is
            set yet (pending Arc DEX confirmation).
          </Text>
        </Card>
      )}

      {done ? <Text style={styles.done}>{done}</Text> : null}
      <RiskNote text="Fixed-price sales settle in USDC. If the soft cap is missed, contributors are refunded in full. Stelix charges no launch fee — gas only." />
    </ScrollView>
  );
}

function FieldPassword({ password, setPassword }: { password: string; setPassword: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Session password (to sign)</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Your wallet password"
        placeholderTextColor={COLORS.textMuted}
        secureTextEntry
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: COLORS.bg, flex: 1 },
  inner: { padding: 16, paddingBottom: 32 },
  note: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 10 },
  done: { color: COLORS.mintDark, fontSize: FONT.small, lineHeight: 18, marginTop: 12 },
  card: { marginTop: 12, padding: 14 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  rowBody: { flex: 1 },
  symbol: { color: COLORS.text, fontSize: FONT.body, fontWeight: '800' },
  name: { color: COLORS.textMuted, fontSize: FONT.small, marginTop: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  label: { color: COLORS.textMuted, fontSize: FONT.label, fontWeight: '700' },
  value: { color: COLORS.text, fontSize: FONT.body, fontWeight: '700', marginTop: 2 },
  meta: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 6 },
  field: { marginTop: 10 },
  fieldLabel: { color: COLORS.textMuted, fontSize: FONT.label, fontWeight: '700', marginBottom: 4 },
  input: {
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: FONT.body,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cta: { marginTop: 12 },
});
