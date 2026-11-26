/** Create a launch — step 1: token (create new via the factory, or use an
 *  existing ERC-20), step 2: sale terms, step 3: review + sign.
 *  Free: no Stelix fee — gas only, paid in USDC on Arc testnet. The seller
 *  deposits the tokens for sale up front (approve + createLaunch), so a
 *  sale can never promise tokens it does not hold. Blocked with an honest
 *  message until the launchpad contracts are deployed on Arc testnet. */
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ethers } from 'ethers';
import { COLORS, FONT } from '../../theme';
import { useApp } from '../../store/AppContext';
import { getLaunchpadDeploymentStatus } from '../../lib/chains';
import { fmtPrice, fmtUsd, shortAddress } from '../../lib/format';
import { getProvider } from '../../lib/balances';
import { getSignerForChain } from '../../lib/signer';
import {
  ERC20_APPROVE_ABI,
  LAUNCHPAD_FREE_NOTE,
  LAUNCHPAD_NOT_DEPLOYED_MESSAGE,
  LAUNCHPAD_USDC_ADDRESS,
  STELIX_LAUNCHPAD_ABI,
  createLaunchOnChain,
  createTokenOnChain,
  estimateGasUsd,
  pricePerTokenMicroUsdc,
  tokensNeededForHardCap,
  validateLaunchParams,
  validateTokenParams,
} from '../../lib/launchpad';
import { Btn, Card, RiskNote, ScreenHeader, SectionTitle } from '../../components/ui';

export default function CreateLaunch() {
  const { chain, address } = useApp();
  const status = getLaunchpadDeploymentStatus(chain.id);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  // Step 1 — new token
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000');
  const [decimals, setDecimals] = useState('18');
  const [logoUrl, setLogoUrl] = useState('');
  // Step 1 — existing token
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenMeta, setTokenMeta] = useState<{ symbol: string; name: string; decimals: number } | null>(null);
  const [checking, setChecking] = useState(false);
  // Step 2 — sale
  const [priceUsd, setPriceUsd] = useState('0.10');
  const [softCap, setSoftCap] = useState('1000');
  const [hardCap, setHardCap] = useState('10000');
  const [startDelayHours, setStartDelayHours] = useState('1');
  const [durationDays, setDurationDays] = useState('7');
  const [liquidityPct, setLiquidityPct] = useState('20');
  const [tokensForSale, setTokensForSale] = useState('100000');
  // Step 3
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<number | null>(null);
  const [gasNote, setGasNote] = useState('');
  const [created, setCreated] = useState<{ saleId: number; token: string; txHash: string } | null>(null);

  const tokenDecimals = mode === 'new' ? parseInt(decimals, 10) || 0 : tokenMeta?.decimals ?? 18;
  const effectiveToken = mode === 'new' ? '' : tokenAddress.trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startTime = nowSeconds + Math.max(0, parseFloat(startDelayHours) || 0) * 3600;
  const endTime = startTime + Math.max(1, parseFloat(durationDays) || 7) * 86400;
  const price = parseFloat(priceUsd) || 0;
  const hard = parseFloat(hardCap) || 0;
  const needed = tokensNeededForHardCap(hard, pricePerTokenMicroUsdc(price), tokenDecimals);
  const neededWhole = Number(needed) / 10 ** tokenDecimals;

  const launchInput = useMemo(
    () => ({
      token: effectiveToken,
      priceUsd: price,
      softCapUsd: parseFloat(softCap) || 0,
      hardCapUsd: hard,
      startTime,
      endTime,
      liquidityLockBps: Math.round((parseFloat(liquidityPct) || 0) * 100),
      tokensForSale: parseFloat(tokensForSale) || 0,
      tokenDecimals,
    }),
    [effectiveToken, price, softCap, hard, startTime, endTime, liquidityPct, tokensForSale, tokenDecimals],
  );

  async function checkExistingToken() {
    if (!ethers.isAddress(tokenAddress.trim())) {
      Alert.alert('Check the address', 'Enter a valid 0x token contract address.');
      return;
    }
    setChecking(true);
    try {
      const provider = getProvider(chain);
      const token = new ethers.Contract(tokenAddress.trim(), ERC20_APPROVE_ABI, provider);
      const [s, n, d] = await Promise.all([token.symbol(), token.name(), token.decimals()]);
      setTokenMeta({ symbol: String(s), name: String(n), decimals: Number(d) });
    } catch {
      setTokenMeta(null);
      Alert.alert('Token not found', 'No ERC-20 token answered at that address on this chain. Check the address and chain.');
    } finally {
      setChecking(false);
    }
  }

  function nextFromToken() {
    if (mode === 'new') {
      const err = validateTokenParams({ name, symbol, totalSupply: parseFloat(supply) || 0, decimals: tokenDecimals, logoUrl: logoUrl || undefined });
      if (err) { Alert.alert('Check the token', err); return; }
    } else {
      if (!tokenMeta) { Alert.alert('Check the token', 'Tap “Check token” first so Stelix can read its name, symbol and decimals on-chain.'); return; }
    }
    setStep(2);
  }

  function nextFromSale() {
    const err = validateLaunchParams(launchInput, nowSeconds);
    if (err) { Alert.alert('Check the sale', err); return; }
    setStep(3);
    void estimateGas();
  }

  async function estimateGas() {
    if (!status.deployed || !address) { setGasNote('Gas estimate appears once the launchpad is deployed.'); return; }
    try {
      const provider = getProvider(chain);
      const launchpad = new ethers.Contract(status.launchpad, STELIX_LAUNCHPAD_ABI, provider);
      const populated = await launchpad.createLaunch.populateTransaction(
        launchInput.token,
        pricePerTokenMicroUsdc(launchInput.priceUsd),
        BigInt(Math.round(launchInput.softCapUsd * 1e6)),
        BigInt(Math.round(launchInput.hardCapUsd * 1e6)),
        launchInput.startTime,
        launchInput.endTime,
        launchInput.liquidityLockBps,
        ethers.parseUnits(String(launchInput.tokensForSale), launchInput.tokenDecimals),
      );
      const est = await estimateGasUsd(provider, { to: status.launchpad, data: populated.data ?? '0x', from: address });
      if (est !== null) {
        setGasEstimate(est);
        setGasNote(`Estimated gas for the launch transaction: ~${fmtUsd(est)} in USDC. The token approval is a separate small transaction. Your wallet shows the exact gas before you sign.`);
      } else {
        setGasNote('Gas estimate unavailable — your wallet will show the exact gas before you sign.');
      }
    } catch {
      setGasNote('Gas estimate unavailable — your wallet will show the exact gas before you sign.');
    }
  }

  async function confirm() {
    if (!status.deployed) {
      Alert.alert('Launchpad not deployed yet', `${LAUNCHPAD_NOT_DEPLOYED_MESSAGE} (${chain.name}). No launch can be created yet, and nothing is recorded locally — a launch that was never submitted is not a launch.`);
      return;
    }
    if (password.length < 8) {
      Alert.alert('Session password required', 'Enter your session password to sign. A wrong password creates nothing.');
      return;
    }
    if (chain.kind !== 'evm') {
      Alert.alert('Launchpad is EVM-only', 'Launches run on Arc testnet (EVM). Switch your chain to Arc.');
      return;
    }
    setCreating(true);
    try {
      const signer = await getSignerForChain(password, chain.id);
      let token = effectiveToken;
      if (mode === 'new') {
        const createdToken = await createTokenOnChain(signer, chain.id, {
          name, symbol, totalSupply: parseFloat(supply) || 0, decimals: tokenDecimals,
          logoUrl: logoUrl || undefined,
        });
        token = createdToken.tokenAddress;
      }
      const res = await createLaunchOnChain(signer, chain.id, { ...launchInput, token });
      setPassword('');
      setCreated({ saleId: res.saleId, token, txHash: res.txHash });
    } catch (e) {
      Alert.alert('Launch failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
        <ScreenHeader title="Launch created" onBack={() => router.back()} />
        <Card style={styles.done}>
          <Text style={styles.doneTitle}>Sale #{created.saleId} is live on-chain</Text>
          <Text style={styles.doneBody}>Token: {shortAddress(created.token)}</Text>
          <Text style={styles.doneBody}>Price: {fmtPrice(price)} · Hard cap: {fmtUsd(hard)}</Text>
          <Text style={styles.doneBody}>Tx: {shortAddress(created.txHash, 8)}</Text>
          <Text style={styles.doneBody}>{LAUNCHPAD_FREE_NOTE} — you paid gas only.</Text>
          <Btn label="View Launch" onPress={() => router.replace(`/launchpad/${created.saleId}`)} style={styles.doneBtn} />
          <Btn label="Back to Launchpad" variant="ghost" onPress={() => router.replace('/(tabs)/launchpad')} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.inner}>
      <ScreenHeader title="Create a Launch" sub={`Step ${step} of 3 · ${LAUNCHPAD_FREE_NOTE}`} onBack={() => (step > 1 ? setStep(step - 1) : router.back())} />

      {!status.deployed && (
        <Card style={styles.warn}>
          <Text style={styles.warnTitle}>Launchpad not deployed yet</Text>
          <Text style={styles.warnBody}>
            {LAUNCHPAD_NOT_DEPLOYED_MESSAGE} ({chain.name}). You can fill in the form, but nothing can be submitted until the
            contracts are deployed. No launch is recorded until it is on-chain.
          </Text>
        </Card>
      )}
      {chain.id !== 'arc' && (
        <Text style={styles.note}>Launchpad launches on Arc testnet. Switch your chain to Arc before signing.</Text>
      )}

      {step === 1 && (
        <>
          <SectionTitle title="1 · The token" />
          <View style={styles.toggle}>
            <Btn label="Create a new token" variant={mode === 'new' ? 'primary' : 'ghost'} onPress={() => setMode('new')} />
            <Btn label="Use an existing token" variant={mode === 'existing' ? 'primary' : 'ghost'} onPress={() => setMode('existing')} />
          </View>
          {mode === 'new' ? (
            <Card style={styles.card}>
              <Field label="Token name" value={name} onChange={setName} placeholder="e.g. Glow Token" />
              <Field label="Symbol" value={symbol} onChange={setSymbol} placeholder="e.g. GLOW" autoCapitalize="characters" />
              <Field label="Total supply" value={supply} onChange={setSupply} placeholder="1000000" keyboardType="numeric" />
              <Field label="Decimals (0–18)" value={decimals} onChange={setDecimals} placeholder="18" keyboardType="numeric" />
              <Field label="Logo image URL (optional)" value={logoUrl} onChange={setLogoUrl} placeholder="https://…/logo.png" autoCapitalize="none" />
              <Text style={styles.note}>The full supply is minted to you. The token is a plain ERC-20 — no mint, burn, pause or tax.</Text>
            </Card>
          ) : (
            <Card style={styles.card}>
              <Field label="Token contract address" value={tokenAddress} onChange={setTokenAddress} placeholder="0x…" autoCapitalize="none" />
              <Btn label={checking ? 'Checking…' : 'Check token'} variant="secondary" onPress={checkExistingToken} loading={checking} />
              {tokenMeta && (
                <Text style={styles.meta}>
                  {tokenMeta.name} ({tokenMeta.symbol}) · {tokenMeta.decimals} decimals
                </Text>
              )}
            </Card>
          )}
          <Btn label="Continue to sale terms" onPress={nextFromToken} style={styles.cta} />
        </>
      )}

      {step === 2 && (
        <>
          <SectionTitle title="2 · Sale terms" />
          <Card style={styles.card}>
            <Field label="Sale price per token (USDC)" value={priceUsd} onChange={setPriceUsd} placeholder="0.10" keyboardType="decimal-pad" />
            <Text style={styles.meta}>Shown to buyers as {fmtPrice(price)} per token.</Text>
            <Field label="Soft cap (USDC)" value={softCap} onChange={setSoftCap} placeholder="1000" keyboardType="numeric" />
            <Field label="Hard cap (USDC)" value={hardCap} onChange={setHardCap} placeholder="10000" keyboardType="numeric" />
            <Field label="Starts in (hours from now)" value={startDelayHours} onChange={setStartDelayHours} placeholder="1" keyboardType="numeric" />
            <Field label="Sale length (days)" value={durationDays} onChange={setDurationDays} placeholder="7" keyboardType="numeric" />
            <Field label="Liquidity lock (%) — max 50" value={liquidityPct} onChange={setLiquidityPct} placeholder="20" keyboardType="numeric" />
            <Field label="Tokens for sale" value={tokensForSale} onChange={setTokensForSale} placeholder="100000" keyboardType="numeric" />
            <Text style={styles.meta}>
              At {fmtPrice(price)} you must offer at least {neededWhole.toLocaleString('en-US')} tokens to cover the ${hard.toLocaleString('en-US')} hard cap.
            </Text>
            <Text style={styles.note}>
              Liquidity lock is pending Arc DEX confirmation: the reserve stays locked in the launchpad until a liquidity manager is set — it is
              never paid out to the seller.
            </Text>
          </Card>
          <Btn label="Review launch" onPress={nextFromSale} style={styles.cta} />
        </>
      )}

      {step === 3 && (
        <>
          <SectionTitle title="3 · Review & sign" />
          <Card style={styles.card}>
            <Row label="Token" value={mode === 'new' ? `${name} (${symbol.toUpperCase()})` : tokenMeta ? `${tokenMeta.name} (${tokenMeta.symbol})` : shortAddress(effectiveToken)} />
            <Row label="Supply / for sale" value={mode === 'new' ? `${supply} / ${tokensForSale}` : tokensForSale} />
            <Row label="Price" value={fmtPrice(price)} />
            <Row label="Soft / hard cap" value={`${fmtUsd(parseFloat(softCap) || 0)} / ${fmtUsd(hard)}`} />
            <Row label="Sale window" value={`${new Date(startTime * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} → ${new Date(endTime * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`} />
            <Row label="Liquidity lock" value={`${liquidityPct}% (pending Arc DEX confirmation)`} />
            <Row label="Stelix fee" value="None — gas only" />
            <Row label="Gas" value={gasEstimate !== null ? `~${fmtUsd(gasEstimate)} (estimate)` : 'Shown by your wallet at signing'} />
            {gasNote ? <Text style={styles.note}>{gasNote}</Text> : null}
            <Text style={styles.note}>You approve the token deposit, then the launch is created on-chain. USDC on Arc is both the sale currency and the gas asset ({shortAddress(LAUNCHPAD_USDC_ADDRESS, 4)}).</Text>
          </Card>
          <Field label="Session password (to sign)" value={password} onChange={setPassword} placeholder="Your wallet password" secureTextEntry />
          <Btn label={creating ? 'Creating…' : 'Create launch on-chain'} onPress={confirm} loading={creating} disabled={!status.deployed} style={styles.cta} />
          <RiskNote text="Only launch a token you have the right to sell. If the soft cap is missed, contributors are refunded in full and your deposited tokens return to you." />
        </>
      )}
    </ScrollView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={COLORS.textMuted}
        keyboardType={props.keyboardType ?? 'default'}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: COLORS.bg, flex: 1 },
  inner: { padding: 16, paddingBottom: 32 },
  warn: { borderColor: COLORS.amber, borderWidth: 1, marginTop: 12, padding: 14 },
  warnTitle: { color: COLORS.text, fontSize: FONT.body, fontWeight: '800' },
  warnBody: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 4 },
  note: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 10 },
  meta: { color: COLORS.text, fontSize: FONT.small, marginTop: 8 },
  toggle: { flexDirection: 'row', gap: 8, marginTop: 12 },
  card: { marginTop: 12, padding: 14 },
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
  cta: { marginTop: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  summaryLabel: { color: COLORS.textMuted, fontSize: FONT.small },
  summaryValue: { color: COLORS.text, fontSize: FONT.small, fontWeight: '700', textAlign: 'right' },
  done: { marginTop: 12, padding: 16 },
  doneTitle: { color: COLORS.text, fontSize: FONT.title, fontWeight: '800' },
  doneBody: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 6 },
  doneBtn: { marginTop: 14 },
});
