/** Screen 6 — Home / Portfolio (v1): address pill top left, chain pill top
 *  right, navy portfolio card, 5 actions in a white card, My Assets list
 *  with Import, bottom tabs Home/Swap/Discover/History/Settings.
 *  Plus v2-only, in v1 style: Spendable vs Locked split inside the card.
 *  All figures come from the store — a new wallet shows $0.00 / 0 tokens. */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  Lock,
  TrendingUp,
  User,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtNum, fmtUsd, shortAddress } from '../../lib/format';
import { addImportedToken, resolveTokenMetadata } from '../../lib/balances';
import {
  BottomSheet,
  Btn,
  Card,
  Chip,
  EmptyState,
  NetworkSheet,
  ProgressBar,
  RiskNote,
  SectionTitle,
} from '../../components/ui';
import { TokenRow } from '../../components/TokenRow';

export default function Home() {
  const { address, chain, tokens, locks, refreshAll, refreshBalances } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [showSpam, setShowSpam] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importAddr, setImportAddr] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  const visible = tokens.filter((t) => !t.isSpam || showSpam);
  const priceOf = (t: { price: number | null }) => t.price ?? 0;
  const spendable = tokens.reduce((s, t) => s + t.balance * priceOf(t), 0);
  const locked = tokens.reduce((s, t) => s + t.locked * priceOf(t), 0);
  const total = spendable + locked;
  const lockedRatio = total > 0 ? locked / total : 0;
  const native = tokens.find((t) => t.symbol === chain.nativeSymbol);
  const assetCount = tokens.filter((t) => !t.isSpam && (t.balance > 0 || t.locked > 0)).length;
  const activeLocks = locks.filter((l) => l.status === 'active' || l.status === 'partially-sold').length;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }

  async function submitImport() {
    const a = importAddr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setImportMsg('Enter a valid contract address (0x followed by 40 hex characters).');
      return;
    }
    setImporting(true);
    setImportMsg('');
    try {
      // Resolve symbol/name/decimals live from the chain, save to the
      // imported-token list, then re-read balances.
      const meta = await resolveTokenMetadata(chain, a);
      await addImportedToken({ chainId: chain.id, address: a, ...meta });
      await refreshBalances();
      setImportMsg(`Imported ${meta.symbol} (${meta.name}).`);
      setImportAddr('');
    } catch (e) {
      setImportMsg(`Could not import that token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  const bal = (v: number) => (hidden ? '••••••' : fmtUsd(v));

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.addrPill} onPress={() => setWalletsOpen(true)}>
          <View style={styles.addrAvatar}>
            <User size={14} color="#fff" />
          </View>
          <Text style={styles.addrText}>{address ? shortAddress(address) : 'No wallet yet'}</Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
        <Pressable style={styles.netPill} onPress={() => setNetOpen(true)}>
          <View style={styles.netDot} />
          <Text style={styles.netText}>{chain.name}</Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
      </View>

      <Pressable onPress={() => router.push('/(tabs)/vault')}>
        <Card dark style={styles.portfolio}>
          <View style={styles.portHead}>
            <Text style={styles.portLabel}>Portfolio Balance</Text>
            <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
              {hidden ? <EyeOff size={16} color={COLORS.textOnNavyMuted} /> : <Eye size={16} color={COLORS.textOnNavyMuted} />}
            </Pressable>
          </View>
          <Text style={styles.balance}>{bal(total)}</Text>
          <View style={styles.pillsRow}>
            <Chip label={chain.nativeSymbol} tone="navy" />
            {chain.testnet ? <Chip label="Testnet" tone="amber" /> : null}
          </View>
          <View style={styles.divider} />
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{chain.nativeSymbol}</Text>
              <Text style={styles.statValue}>{native ? fmtNum(native.balance, 4) : '0'}</Text>
              <Text style={styles.statSub}>{bal(native ? native.balance * priceOf(native) : 0)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Assets</Text>
              <Text style={styles.statValue}>{assetCount}</Text>
              <Text style={styles.statSub}>tokens</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Network</Text>
              <Text style={styles.statValue}>{chain.id === 'bnb' ? 'BSC' : chain.name}</Text>
              <Text style={styles.statSub}>{chain.testnet ? 'Testnet' : 'Mainnet'}</Text>
            </View>
          </View>
          <View style={styles.split}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Spendable</Text>
              <Text style={styles.splitValue}>{bal(spendable)}</Text>
            </View>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Locked</Text>
              <Text style={[styles.splitValue, { color: COLORS.mint }]}>{bal(locked)}</Text>
            </View>
            <Text style={styles.splitPct}>{Math.round(lockedRatio * 100)}% locked</Text>
          </View>
          <ProgressBar value={lockedRatio} />
          {activeLocks > 0 ? (
            <Text style={styles.lockNote}>{activeLocks} active lock{activeLocks > 1 ? 's' : ''} — tap to open the Vault</Text>
          ) : null}
        </Card>
      </Pressable>

      <Card style={styles.actionsCard}>
        <View style={styles.actions}>
          <Action icon={<ArrowUpRight size={20} color="#fff" />} label="Send" onPress={() => router.push('/send')} />
          <View style={styles.actionDiv} />
          <Action icon={<ArrowDownLeft size={20} color="#fff" />} label="Receive" onPress={() => router.push('/receive')} />
          <View style={styles.actionDiv} />
          <Action icon={<TrendingUp size={20} color="#fff" />} label="Swap" onPress={() => router.push('/(tabs)/swap')} />
          <View style={styles.actionDiv} />
          <Action icon={<History size={20} color="#fff" />} label="History" onPress={() => router.push('/(tabs)/history')} />
          <View style={styles.actionDiv} />
          <Action icon={<Lock size={20} color="#fff" />} label="Discipline" onPress={() => router.push('/discipline')} />
        </View>
      </Card>

      <SectionTitle
        title="My Assets"
        right={
          <Btn label="+ Import" onPress={() => setImportOpen(true)} style={styles.importBtn} />
        }
      />
      {visible.length === 0 ? (
        <EmptyState
          title="No tokens yet"
          body="Receive funds or import a token to see your assets here."
          actionLabel="Receive"
          onAction={() => router.push('/receive')}
        />
      ) : (
        visible.map((t) => <TokenRow key={t.symbol} token={t} onPress={() => router.push(`/token/${t.symbol}`)} />)
      )}
      {tokens.some((t) => t.isSpam) && (
        <Pressable onPress={() => setShowSpam((s) => !s)}>
          <Text style={styles.spamToggle}>
            {showSpam
              ? 'Hide spam folder'
              : `Spam folder (${tokens.filter((t) => t.isSpam).length} hidden token${tokens.filter((t) => t.isSpam).length > 1 ? 's' : ''})`}
          </Text>
        </Pressable>
      )}
      <RiskNote />

      <NetworkSheet visible={netOpen} onClose={() => setNetOpen(false)} />

      <BottomSheet visible={walletsOpen} onClose={() => setWalletsOpen(false)} title="Wallets">
        <Pressable
          style={styles.walletRow}
          onPress={() => {
            Clipboard.setStringAsync(address);
            setWalletsOpen(false);
          }}
        >
          <View style={styles.walletIcon}>
            <User size={16} color="#fff" />
          </View>
          <View style={styles.walletMid}>
            <Text style={styles.walletName}>Wallet 1</Text>
            <Text style={styles.walletAddr}>{address ? shortAddress(address) : 'No wallet yet'}</Text>
          </View>
          <Text style={styles.walletCheck}>✓</Text>
        </Pressable>
        <Pressable
          style={styles.walletRow}
          onPress={() => {
            setWalletsOpen(false);
            router.push('/import');
          }}
        >
          <View style={styles.walletAdd}>
            <Text style={styles.walletAddText}>+</Text>
          </View>
          <Text style={styles.walletName}>Add / Import Wallet</Text>
          <ChevronRight size={16} color={COLORS.textMuted} />
        </Pressable>
        <Text style={styles.sheetHint}>Tap the wallet to copy its address.</Text>
      </BottomSheet>

      <BottomSheet visible={importOpen} onClose={() => setImportOpen(false)} title="Import Token">
        <Text style={styles.sheetHint}>Paste the contract address. We will fetch details automatically.</Text>
        <TextInput
          style={styles.importInput}
          placeholder="Contract Address (0x…)"
          autoCapitalize="none"
          autoCorrect={false}
          value={importAddr}
          onChangeText={(v) => {
            setImportAddr(v);
            setImportMsg('');
          }}
        />
        {importMsg ? <Text style={styles.importErr}>{importMsg}</Text> : null}
        <Btn label={importing ? 'Importing…' : 'Import Token'} onPress={submitImport} disabled={!importAddr.trim() || importing} style={styles.importSubmit} />
      </BottomSheet>
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flex: 1, gap: 6 },
  actionDiv: { backgroundColor: COLORS.border, height: 40, width: 1 },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actionLabel: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  actions: { alignItems: 'center', flexDirection: 'row' },
  actionsCard: { marginTop: 12, paddingVertical: 14 },
  addrAvatar: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  addrPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addrText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  balance: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 2 },
  divider: { backgroundColor: COLORS.navySoft, height: 1, marginVertical: 10 },
  importBtn: { minHeight: 32, paddingHorizontal: 12 },
  importErr: { color: COLORS.red, fontSize: 12, marginTop: 8 },
  importInput: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 12,
    padding: 12,
  },
  importSubmit: { marginTop: 12 },
  inner: { padding: 12 },
  lockNote: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 8 },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  netPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  netText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  pillsRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  portHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  portLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  portfolio: { padding: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sheetHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  spamToggle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  split: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 8, marginTop: 10 },
  splitCol: { flex: 1 },
  splitLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  splitPct: { color: COLORS.textOnNavyMuted, fontSize: 11, fontWeight: '700' },
  splitValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 2 },
  stat: { flex: 1 },
  statLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  statSub: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 2 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 2 },
  stats: { flexDirection: 'row', gap: 8 },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  walletAdd: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  walletAddText: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  walletAddr: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  walletCheck: { color: COLORS.mintDark, fontSize: 16, fontWeight: '800' },
  walletIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  walletMid: { flex: 1 },
  walletName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  walletRow: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    padding: 10,
  },
});
