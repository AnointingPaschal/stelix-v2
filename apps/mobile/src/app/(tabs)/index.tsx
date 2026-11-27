/** Screen 6 — Home / Portfolio (v1): address pill top left, chain pill top
 *  right, navy portfolio card, 5 actions in a white card, My Assets list
 *  with Import, bottom tabs Home/Swap/Discover/History/Settings.
 *  Plus v2-only, in v1 style: Spendable vs Locked split inside the card.
 *  All figures come from the store — a new wallet shows $0.00 / 0 tokens.
 *
 *  Import Token sheet: pasting a contract address fetches the token FIRST
 *  (on-chain symbol/name/decimals + real logo + live price) and shows a
 *  preview card — large logo, name, symbol, decimals, chain, contract
 *  address — before "Import Token" can be tapped. A missing logo shows
 *  the letter fallback plus a "Logo not found" note; an unreadable
 *  contract shows a visible inline error, never a silent failure. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
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
import { fmtNum, fmtPct, fmtPrice, fmtUsd, shortAddress } from '../../lib/format';
import { loadWatchlist, resolveWatchlistEntries, type WatchlistEntry } from '../../lib/watchlist';
import { addImportedToken, resolveTokenMetadata, visibleTokens } from '../../lib/balances';
import { createImportInputController } from '../../lib/importToken';
import { fetchDexScreenerToken } from '../../lib/prices';
import { fetchFactoryLogo, resolveTokenLogo } from '../../lib/tokenLogos';
import { tokenDetailRoute } from '../../lib/tokenResolve';
import { findRegistryToken, visibleAnnouncements } from '../../lib/adminSync';
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
import { TokenLogo } from '../../components/TokenLogo';

interface ImportPreview {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  priceUsd: number | null;
}

export default function Home() {
  const { address, chain, tokens, locks, refreshAll, refreshBalances, announcements, maintenance, signingBlocked, dismissAnnouncement, adminTokens, adminTokensSynced, networkMode } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 320–430px phones keep the compact v1 layout; 768px+ centres the
  // column at 768px so the page never stretches edge-to-edge on web.
  const isWide = width >= 768;
  const isNarrow = width < 360;
  const [refreshing, setRefreshing] = useState(false);
  const [showSpam, setShowSpam] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importAddr, setImportAddr] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importOk, setImportOk] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Watchlist (starred on Token Detail): resolved on every focus, so a
  // star added on the detail page shows here when the user comes back.
  // The old star wrote to storage and no screen ever listed it.
  const [watchEntries, setWatchEntries] = useState<WatchlistEntry[]>([]);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const keys = await loadWatchlist();
        if (cancelled) return;
        const entries = await resolveWatchlistEntries(keys, tokens);
        if (!cancelled) setWatchEntries(entries);
      })();
      return () => {
        cancelled = true;
      };
    }, [tokens]),
  );
  // Sequence guard: a preview fetch that resolves after the user typed a
  // different address (or closed the sheet) is discarded, never shown.
  const previewSeq = useRef(0);
  const fetchPreviewRef = useRef(fetchImportPreview);
  useEffect(() => {
    fetchPreviewRef.current = fetchImportPreview;
  });
  // Debounced address handler (pure, unit-tested in lib/__tests__/
  // importToken.test.ts): focus/typing/paste/clear never throw, a valid
  // paste fires one fetch, an invalid address shows an inline error.
  const importController = useRef(
    createImportInputController({
      onValidAddress: (a) => void fetchPreviewRef.current(a),
      onInvalidAddress: (msg) => {
        previewSeq.current++; // invalidate any in-flight preview fetch
        setImportMsg(msg);
        setImportOk('');
        setImportPreview(null);
      },
      onCleared: () => {
        previewSeq.current++;
        setImportMsg('');
        setImportOk('');
        setImportPreview(null);
      },
    }),
  );

  useEffect(() => {
    return () => importController.current.cancel();
  }, []);

  /** Fetch the token BEFORE it can be imported: on-chain metadata + real
   *  logo + live price. Shows a preview card; errors are inline. */
  async function fetchImportPreview(a: string) {
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    setImportMsg('');
    setImportOk('');
    setImportPreview(null);
    try {
      const [meta, logo, market] = await Promise.all([
        resolveTokenMetadata(chain, a),
        // Stelix sources first: the registry logo (admin-verified) and
        // the on-chain factory logoURI — so a launched token's logo shows
        // in the preview (and is saved at import) wherever its address
        // is imported, before any public source is tried.
        resolveTokenLogo(chain.id, a, {
          registryLogoUrl: findRegistryToken(adminTokens, chain.id, a)?.logoUrl ?? null,
          factoryLogo: () => fetchFactoryLogo(chain, a),
        }).catch(() => ({ url: null as string | null, source: 'none' as const })),
        fetchDexScreenerToken(chain.id, a).catch(() => null),
      ]);
      if (seq !== previewSeq.current) return; // superseded — a newer address was typed
      setImportPreview({
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        logoUrl: logo.url,
        priceUsd: market?.priceUsd ?? null,
      });
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setImportMsg(
        `Could not read that contract on ${chain.name} — it may not be a token contract. ${e instanceof Error ? e.message : ''}`,
      );
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }

  function onImportAddrChange(v: string) {
    setImportAddr(v);
    importController.current.change(v);
  }

  function resetImportSheet() {
    importController.current.cancel();
    previewSeq.current++;
    setImportAddr('');
    setImportMsg('');
    setImportOk('');
    setImportPreview(null);
    setPreviewLoading(false);
    setImporting(false);
  }

  const visible = visibleTokens(tokens, showSpam);
  // Latest admin announcement for this chain (audience 'all' or this
  // chain's slug), unless dismissed. Maintenance scope 'wallet' shows a
  // banner here too (scope 'all' replaces the whole screen instead).
  const banner = visibleAnnouncements(announcements, chain.id)[0] ?? null;
  const priceOf = (t: { price: number | null }) => t.price ?? 0;
  const spendable = tokens.reduce((s, t) => s + t.balance * priceOf(t), 0);
  const locked = tokens.reduce((s, t) => s + t.locked * priceOf(t), 0);
  const total = spendable + locked;
  const lockedRatio = total > 0 ? locked / total : 0;
  const native = tokens.find((t) => t.symbol === chain.nativeSymbol);
  // Count the rows actually listed — 0-balance default/imported rows are
  // listed too, so a balance>0 filter would show "Assets 0" under them.
  const assetCount = visible.length;
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
    // The Import button is only enabled once a preview has loaded, so the
    // user has seen the real logo + name + symbol before anything is added.
    if (!importPreview) {
      setImportMsg('Still fetching the token — wait for the preview, then tap Import Token.');
      return;
    }
    setImporting(true);
    setImportMsg('');
    setImportOk('');
    try {
      await addImportedToken({
        chainId: chain.id,
        address: a,
        symbol: importPreview.symbol,
        name: importPreview.name,
        decimals: importPreview.decimals,
        logoUrl: importPreview.logoUrl,
      });
      await refreshBalances();
      setImportOk(`Imported ${importPreview.symbol} (${importPreview.name}).`);
      setImportAddr('');
      setImportPreview(null);
    } catch (e) {
      setImportOk('');
      setImportMsg(`Could not import that token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  const bal = (v: number) => (hidden ? '••••••' : fmtUsd(v));

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.inner,
        {
          paddingTop: 12 + insets.top,
          paddingBottom: 24 + insets.bottom,
          ...(isWide ? { maxWidth: 768, width: '100%', alignSelf: 'center' } : null),
        },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.topRow}>
        <Pressable style={styles.addrPill} onPress={() => setWalletsOpen(true)}>
          <View style={styles.addrAvatar}>
            <User size={14} color="#fff" />
          </View>
          <Text style={styles.addrText} numberOfLines={1}>
            {address ? shortAddress(address, isNarrow ? 4 : 6) : 'No wallet yet'}
          </Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
        <Pressable style={styles.netPill} onPress={() => setNetOpen(true)}>
          <View style={styles.netDot} />
          <Text style={styles.netText} numberOfLines={1}>{chain.name}</Text>
          <ChevronDown size={14} color={COLORS.textMuted} />
        </Pressable>
      </View>

      {signingBlocked && maintenance.scope === 'wallet' ? (
        <View style={styles.maintBanner}>
          <Text style={styles.maintBannerTitle}>Maintenance is on</Text>
          <Text style={styles.maintBannerText}>
            {maintenance.message !== '' ? maintenance.message : 'Sending, swapping and locking are paused while maintenance is in progress.'}
          </Text>
        </View>
      ) : null}

      {banner ? (
        <View style={styles.announceBanner}>
          <View style={styles.announceHead}>
            <Text style={styles.announceTitle} numberOfLines={1}>{banner.title}</Text>
            <Pressable onPress={() => dismissAnnouncement(banner.id)} hitSlop={8}>
              <Text style={styles.announceDismiss}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.announceText}>{banner.message}</Text>
        </View>
      ) : null}

      <Pressable onPress={() => router.push('/(tabs)/vault')}>
        <Card dark style={styles.portfolio}>
          <View style={styles.portHead}>
            <Text style={styles.portLabel}>Portfolio Balance</Text>
            <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
              {hidden ? <EyeOff size={16} color={COLORS.textOnNavyMuted} /> : <Eye size={16} color={COLORS.textOnNavyMuted} />}
            </Pressable>
          </View>
          <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(total)}</Text>
          <View style={styles.pillsRow}>
            <Chip label={chain.nativeSymbol} tone="navy" />
            {chain.testnet ? <Chip label="Testnet" tone="amber" /> : null}
            {networkMode !== null ? <Chip label={networkMode === 'testnet' ? 'Testnet mode' : 'Mainnet mode'} tone="navy" /> : null}
          </View>
          <View style={styles.divider} />
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{chain.nativeSymbol}</Text>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{native ? fmtNum(native.balance, 4) : '0'}</Text>
              <Text style={styles.statSub} numberOfLines={1}>{bal(native ? native.balance * priceOf(native) : 0)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Assets</Text>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{assetCount}</Text>
              <Text style={styles.statSub} numberOfLines={1}>tokens</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Network</Text>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{chain.id === 'bnb' ? 'BSC' : chain.name}</Text>
              <Text style={styles.statSub} numberOfLines={1}>{chain.testnet ? 'Testnet' : 'Mainnet'}</Text>
            </View>
          </View>
          <View style={styles.split}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Spendable</Text>
              <Text style={styles.splitValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(spendable)}</Text>
            </View>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>Locked</Text>
              <Text style={[styles.splitValue, { color: COLORS.mint }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{bal(locked)}</Text>
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
        visible.map((t) => (
          <TokenRow
            key={`${t.chainId}:${t.address || t.symbol}`}
            token={t}
            onPress={() => router.push(tokenDetailRoute(t))}
          />
        ))
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

      {watchEntries.length > 0 ? (
        <>
          <SectionTitle title="Watchlist" />
          {watchEntries.map((w) => (
            <Pressable
              key={w.key}
              style={styles.watchRow}
              onPress={() =>
                router.push(tokenDetailRoute({ symbol: w.symbol, address: w.address, chainId: w.chainId }))
              }
            >
              <TokenLogo chainId={w.chainId} address={w.address} symbol={w.symbol} size={38} fallbackTone="light" />
              <View style={styles.watchMid}>
                <Text style={styles.watchName} numberOfLines={1}>
                  {w.symbol || shortAddress(w.address, 4)}
                </Text>
                <Text style={styles.watchSub} numberOfLines={1}>
                  {w.held ? `Held · ${fmtNum(w.balance, 4)}` : w.name || w.chainId}
                </Text>
              </View>
              <View style={styles.watchRight}>
                <Text style={styles.watchPrice} numberOfLines={1}>
                  {w.priceUsd === null ? '—' : fmtPrice(w.priceUsd)}
                </Text>
                <Text
                  style={[
                    styles.watchChange,
                    { color: w.change24h === null ? COLORS.textMuted : w.change24h >= 0 ? COLORS.mintDark : COLORS.red },
                  ]}
                  numberOfLines={1}
                >
                  {w.change24h === null ? '' : fmtPct(w.change24h)}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
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
          <Check size={16} color={COLORS.mintDark} />
        </Pressable>
        <Pressable
          style={styles.walletRow}
          onPress={() => {
            setWalletsOpen(false);
            router.push('/wallet-setup');
          }}
        >
          <View style={styles.walletAdd}>
            <Text style={styles.walletAddText}>+</Text>
          </View>
          <Text style={styles.walletName}>Import / Create wallet</Text>
          <ChevronRight size={16} color={COLORS.textMuted} />
        </Pressable>
        <Text style={styles.sheetHint}>Tap the wallet to copy its address.</Text>
        <Text style={styles.sheetHint}>Creating a new wallet or switching wallets replaces the current wallet on this device — back up its seed phrase first or you will lose access to it.</Text>
      </BottomSheet>

      <BottomSheet
        visible={importOpen}
        onClose={() => {
          setImportOpen(false);
          resetImportSheet();
        }}
        title="Import Token"
      >
        <Text style={styles.sheetHint}>Paste the contract address. We will fetch the token first so you can confirm it before importing.</Text>
        <TextInput
          style={styles.importInput}
          placeholder="Contract Address (0x…)"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          value={importAddr}
          onChangeText={onImportAddrChange}
          onBlur={() => importController.current.blur(importAddr)}
        />
        {previewLoading ? <Text style={styles.previewLoading}>Fetching token details…</Text> : null}
        {importPreview ? (
          <View style={styles.previewCard}>
            <TokenLogo
              chainId={chain.id}
              address={importAddr.trim()}
              symbol={importPreview.symbol}
              size={64}
              logoUrl={importPreview.logoUrl}
            />
            <View style={styles.previewMid}>
              <Text style={styles.previewName} numberOfLines={1}>{importPreview.name}</Text>
              <Text style={styles.previewSub} numberOfLines={1}>
                {importPreview.symbol} · {importPreview.decimals} decimals · {chain.name}
              </Text>
              <Pressable
                style={styles.previewAddrRow}
                onPress={() => void Clipboard.setStringAsync(importAddr.trim())}
                hitSlop={6}
              >
                <Text style={styles.previewAddr}>{shortAddress(importAddr.trim())}</Text>
                <Copy size={12} color={COLORS.textMuted} />
              </Pressable>
              <Text style={styles.previewPrice}>
                {importPreview.priceUsd === null ? 'Price unavailable' : fmtPrice(importPreview.priceUsd)}
              </Text>
              {/* Token registry: a verified badge when the admin registered
                  this token, an honest warning when it is not registered.
                  Shown only after at least one admin sync — before that,
                  the registry state is unknown, so nothing is claimed. */}
              {adminTokensSynced ? (
                findRegistryToken(adminTokens, chain.id, importAddr.trim()) ? (
                  <Text style={styles.registryOk}>Verified in the Stelix registry</Text>
                ) : (
                  <Text style={styles.registryWarn}>Not in the Stelix registry — check the contract before importing.</Text>
                )
              ) : null}
            </View>
          </View>
        ) : null}
        {importPreview && !importPreview.logoUrl ? (
          <Text style={styles.logoWarn}>Logo not found — please check the contract address. Name and symbol were read from the contract.</Text>
        ) : null}
        {importMsg ? <Text style={styles.importErr}>{importMsg}</Text> : null}
        {importOk ? <Text style={styles.importOk}>{importOk}</Text> : null}
        <Btn
          label={importing ? 'Importing…' : 'Import Token'}
          onPress={submitImport}
          disabled={!importPreview || importing || previewLoading}
          style={styles.importSubmit}
        />
        {/* Bottom spacer: with the keyboard open, the sheet's ScrollView
            can scroll the input, preview card and Import button above the
            keyboard instead of the button sitting on the last pixel. */}
        <View style={styles.importBottomPad} />
      </BottomSheet>
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flex: 1, gap: 6, minWidth: 0 },
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
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addrText: { color: COLORS.text, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  balance: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 2 },
  divider: { backgroundColor: COLORS.navySoft, height: 1, marginVertical: 10 },
  importBtn: { minHeight: 32, paddingHorizontal: 12 },
  importErr: { color: COLORS.red, fontSize: 12, marginTop: 8 },
  importOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', marginTop: 8 },
  registryOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', marginTop: 6 },
  registryWarn: { color: '#B45309', fontSize: 12, marginTop: 6 },
  maintBanner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  maintBannerTitle: { color: '#92400E', fontSize: 14, fontWeight: '800' },
  maintBannerText: { color: '#92400E', fontSize: 13, lineHeight: 18, marginTop: 4 },
  announceBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  announceHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  announceTitle: { color: COLORS.navy, flex: 1, fontSize: 14, fontWeight: '800' },
  announceDismiss: { color: COLORS.textMuted, fontSize: 14, fontWeight: '700', paddingHorizontal: 4 },
  announceText: { color: COLORS.text, fontSize: 13, lineHeight: 18, marginTop: 4 },
  importInput: {
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    marginTop: 12,
    padding: 12,
  },
  importBottomPad: { height: 48 },
  importSubmit: { marginBottom: 16, marginTop: 12 },
  logoWarn: {
    backgroundColor: COLORS.amberSoft,
    borderRadius: 12,
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    padding: 10,
  },
  previewAddr: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  previewAddrRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 4 },
  previewCard: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 12,
  },
  previewLoading: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  previewMid: { flex: 1, minWidth: 0 },
  previewName: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  previewPrice: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  previewSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  inner: { padding: 12 },
  lockNote: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 8 },
  netDot: { backgroundColor: COLORS.mint, borderRadius: 999, height: 8, width: 8 },
  netPill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  netText: { color: COLORS.text, flexShrink: 1, fontSize: 12, fontWeight: '700' },
  pillsRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  portHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  portLabel: { color: COLORS.textOnNavyMuted, fontSize: 12, fontWeight: '700' },
  portfolio: { padding: 14 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  sheetHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  spamToggle: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  split: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 8, marginTop: 10 },
  splitCol: { flex: 1, minWidth: 0 },
  splitLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  splitPct: { color: COLORS.textOnNavyMuted, fontSize: 11, fontWeight: '700' },
  splitValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 2 },
  stat: { flex: 1, minWidth: 0 },
  statLabel: { color: COLORS.textOnNavyMuted, fontSize: 11 },
  statSub: { color: COLORS.textOnNavyMuted, fontSize: 11, marginTop: 2 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 2 },
  stats: { flexDirection: 'row', gap: 8 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 12 },
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
  watchChange: { fontSize: 12, fontWeight: '700', marginTop: 2, textAlign: 'right' },
  watchMid: { flex: 1, minWidth: 0 },
  watchName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  watchPrice: { color: COLORS.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  watchRight: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  watchRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  watchSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
});
