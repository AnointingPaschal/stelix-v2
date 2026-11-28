/** Screen — Import Token (full-screen modal): one search box, two modes.
 *  Paste a 0x contract address and the screen fetches that exact token
 *  (on-chain symbol/name/decimals + real logo + live price) and shows
 *  the preview before anything can be activated. Type a name or symbol
 *  and it searches DexScreener and lists every match, each with an
 *  Activate toggle (on = visible in My Assets, off = hidden but
 *  remembered — a toggled-off token never reappears on refresh).
 *  Tapping a row opens a detail modal with the same toggle.
 *
 *  The chain row at the top drives everything below; it only switches
 *  the chain for this screen, not the wallet's active chain. Derived
 *  rows (default stables, registry tokens) are always on and cannot be
 *  toggled off — their toggle is disabled and says so. */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Search, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';
import { useApp } from '../store/AppContext';
import { fmtPrice, shortAddress } from '../lib/format';
import { getChain, isChainUsable, type ChainConfig } from '../lib/chains';
import {
  addImportedToken,
  loadImportedTokens,
  removeImportedToken,
  resolveTokenMetadata,
} from '../lib/balances';
import {
  detectImportSearchMode,
  hiddenTokenKey,
  isPartialContractAddress,
  setTokenVisibility,
  type ImportSearchMode,
} from '../lib/importToken';
import { searchTokens, type DiscoverToken } from '../lib/discover';
import { fetchDexScreenerToken } from '../lib/prices';
import { fetchFactoryLogo, resolveTokenLogo } from '../lib/tokenLogos';
import { findRegistryToken } from '../lib/adminSync';
import { BottomSheet, Btn, Card, ScreenHeader, Skeleton } from '../components/ui';
import { TokenLogo } from '../components/TokenLogo';
import { BottomNav } from '../components/AppShell';

/** One row in the import screen: a search hit (decimals unknown until
 *  activation) or an address preview (decimals known). */
interface ImportRow {
  chainId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number | null;
  logoUrl: string | null;
  priceUsd: number | null;
  verified: boolean;
}

const TOGGLE_DEPS = { addImportedToken, removeImportedToken };
const SOLANA_NOTE =
  'Solana tokens appear automatically from your token accounts — they cannot be imported by address.';

function discoverRow(t: DiscoverToken, verified: boolean): ImportRow {
  return {
    chainId: t.chainId,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: null,
    logoUrl: t.iconUrl,
    priceUsd: t.priceUsd,
    verified,
  };
}

export default function ImportTokenScreen() {
  const { address: walletAddress, chain, availableChains, adminTokens, adminTokensSynced, refreshBalances } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 768;

  const usableChains = availableChains.filter(isChainUsable);
  const [selectedChainId, setSelectedChainId] = useState(chain.id);
  const selectedChain: ChainConfig =
    usableChains.find((c) => c.id === selectedChainId) ?? usableChains[0] ?? getChain(chain.id);
  const selectedStablecoins = selectedChain.stablecoins;

  const [query, setQuery] = useState('');
  const mode = detectImportSearchMode(query);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<ImportRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [alwaysOnKeys, setAlwaysOnKeys] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ImportRow | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const seqRef = useRef(0);

  function showMsg(text: string, err = false) {
    setMsg(text);
    setMsgErr(err);
  }

  // Active / always-on sets for the selected chain: imported (incl.
  // discovered) rows are toggleable; registry rows and default stables
  // are derived on every load, so they are always on.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const active = new Set<string>();
      const always = new Set<string>();
      try {
        const imported = await loadImportedTokens(walletAddress);
        for (const t of imported) {
          if (t.chainId === selectedChain.id) active.add(hiddenTokenKey(t.chainId, t.address));
        }
      } catch {
        // Best-effort: toggles still work, they just start off.
      }
      for (const r of adminTokens) {
        if (r.chainId === selectedChain.id) {
          const k = hiddenTokenKey(r.chainId, r.address);
          active.add(k);
          always.add(k);
        }
      }
      if (selectedStablecoins) {
        for (const a of [selectedStablecoins.USDT, selectedStablecoins.USDC]) {
          if (!a) continue;
          const k = hiddenTokenKey(selectedChain.id, a);
          active.add(k);
          always.add(k);
        }
      }
      if (!cancelled) {
        setActiveKeys(active);
        setAlwaysOnKeys(always);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChain.id, selectedStablecoins, walletAddress, adminTokens]);

  async function runSearch(q: string, m: ImportSearchMode, sel: ChainConfig) {
    const seq = ++seqRef.current;
    setSearchError('');
    setPreviewError('');
    if (m === 'address') {
      setPreview(null);
      setPreviewLoading(true);
      try {
        if (sel.kind !== 'evm') throw new Error(SOLANA_NOTE);
        const [meta, logo, market] = await Promise.all([
          resolveTokenMetadata(sel, q),
          resolveTokenLogo(sel.id, q, {
            registryLogoUrl: findRegistryToken(adminTokens, sel.id, q)?.logoUrl ?? null,
            factoryLogo: () => fetchFactoryLogo(sel, q),
          }).catch(() => ({ url: null as string | null, source: 'none' as const })),
          fetchDexScreenerToken(sel.id, q).catch(() => null),
        ]);
        if (seq !== seqRef.current) return;
        setPreview({
          chainId: sel.id,
          address: q,
          symbol: meta.symbol,
          name: meta.name,
          decimals: meta.decimals,
          logoUrl: logo.url,
          priceUsd: market?.priceUsd ?? null,
          verified: findRegistryToken(adminTokens, sel.id, q)?.verified ?? false,
        });
      } catch (e) {
        if (seq !== seqRef.current) return;
        setPreviewError(
          e instanceof Error && e.message === SOLANA_NOTE
            ? SOLANA_NOTE
            : `Could not read that contract on ${sel.name} — it may not be a token contract. ${e instanceof Error ? e.message : ''}`,
        );
      } finally {
        if (seq === seqRef.current) {
          setPreviewLoading(false);
          setSearching(false);
        }
      }
      return;
    }
    try {
      const res = await searchTokens(q);
      if (seq !== seqRef.current) return;
      if (res.error) {
        setSearchError(res.error);
        setResults([]);
      } else {
        setResults(
          res.tokens
            .filter((t) => t.chainId === sel.id)
            .map((t) =>
              discoverRow(t, findRegistryToken(adminTokens, sel.id, t.address)?.verified ?? false),
            ),
        );
      }
    } catch (e) {
      if (seq !== seqRef.current) return;
      setSearchError(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
      setResults([]);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }

  // Clearing the query also clears the last search/preview at once
  // (in the event handler, not in an effect, so no cascading render).
  function handleQueryChange(text: string) {
    setQuery(text);
    if (text.trim() === '') {
      setResults([]);
      setPreview(null);
      setPreviewError('');
      setSearchError('');
      setSearching(false);
    }
  }

  // Debounced search: address mode fetches the exact token, search
  // mode queries DexScreener. A stale response (newer query typed, or
  // chain changed) is discarded, never shown. setSearching(true) runs
  // inside the timer callback, not synchronously in the effect body.
  useEffect(() => {
    if (mode === 'empty') return;
    const q = query.trim();
    const sel = selectedChain;
    const timer = setTimeout(() => {
      setSearching(true);
      void runSearch(q, mode, sel);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, selectedChain.id]);

  /** Flip one row's toggle. Turning ON resolves the on-chain metadata
   *  (a search hit has no decimals yet) and the real logo first, so
   *  the saved row is complete; turning OFF removes the import and
   *  records the token as hidden so discovery cannot re-add it. */
  async function toggleRow(row: ImportRow) {
    const k = hiddenTokenKey(row.chainId, row.address);
    if (alwaysOnKeys.has(k) || togglingKey !== null) return;
    const active = activeKeys.has(k);
    setTogglingKey(k);
    showMsg('');
    try {
      if (!active) {
        let { symbol, name } = row;
        let decimals = row.decimals;
        if (decimals === null) {
          if (selectedChain.kind !== 'evm') throw new Error(SOLANA_NOTE);
          const meta = await resolveTokenMetadata(selectedChain, row.address);
          symbol = meta.symbol;
          name = meta.name;
          decimals = meta.decimals;
        }
        let logoUrl = row.logoUrl;
        if (!logoUrl) {
          logoUrl = (
            await resolveTokenLogo(row.chainId, row.address, {
              registryLogoUrl: findRegistryToken(adminTokens, row.chainId, row.address)?.logoUrl ?? null,
              factoryLogo: () => fetchFactoryLogo(selectedChain, row.address),
            }).catch(() => ({ url: null as string | null, source: 'none' as const }))
          ).url;
        }
        await setTokenVisibility({
          chainId: row.chainId,
          address: row.address,
          token: { chainId: row.chainId, address: row.address, symbol, name, decimals, logoUrl },
          visible: true,
          ownerAddress: walletAddress,
          deps: TOGGLE_DEPS,
        });
        setActiveKeys((prev) => new Set(prev).add(k));
        showMsg(`Activated ${symbol} — it will show in My Assets.`);
      } else {
        await setTokenVisibility({
          chainId: row.chainId,
          address: row.address,
          token: null,
          visible: false,
          ownerAddress: walletAddress,
          deps: TOGGLE_DEPS,
        });
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
        showMsg(`Hidden ${row.symbol} — it will stay hidden until you activate it again.`);
      }
      if (row.chainId === chain.id) void refreshBalances();
    } catch (e) {
      showMsg(
        `Could not ${active ? 'hide' : 'activate'} ${row.symbol}: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    } finally {
      setTogglingKey(null);
    }
  }

  const detailActive = detail ? activeKeys.has(hiddenTokenKey(detail.chainId, detail.address)) : false;
  const detailAlwaysOn = detail ? alwaysOnKeys.has(hiddenTokenKey(detail.chainId, detail.address)) : false;

  return (
    <View style={styles.shell}>
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
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="Import Token" sub="Search by name, or paste a contract address" onBack={() => router.back()} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chainRow}>
          {usableChains.map((c) => {
            const selected = c.id === selectedChain.id;
            return (
              <Pressable
                key={c.id}
                style={[styles.chainChip, selected && styles.chainChipSelected]}
                onPress={() => {
                  setSelectedChainId(c.id);
                  setResults([]);
                  setPreview(null);
                }}
              >
                <Text style={[styles.chainChipText, selected && styles.chainChipTextSelected]} numberOfLines={1}>
                  {c.id === 'bnb' ? 'BNB' : c.name}
                  {c.testnet ? ' Testnet' : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.searchBox}>
          <Search size={16} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, symbol, or paste a contract address (0x…)"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="search"
            value={query}
            onChangeText={handleQueryChange}
          />
          {query !== '' ? (
            <Pressable
              onPress={() => handleQueryChange('')}
              hitSlop={8}
              accessibilityLabel="Clear search"
            >
              <X size={16} color={COLORS.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {mode === 'search' && isPartialContractAddress(query) ? (
          <Text style={styles.hint}>Enter the full 42-character address, or search by name or symbol.</Text>
        ) : null}

        {mode === 'empty' ? (
          <Text style={styles.hint}>Search for a token by name or symbol, or paste its contract address to fetch it exactly.</Text>
        ) : null}

        {searching && mode === 'address' && previewLoading ? (
          <Card style={styles.previewCard}>
            <View style={styles.previewTop} accessibilityLabel="Loading token details">
              <Skeleton height={64} width={64} />
              <View style={styles.previewSkelMid}>
                <Skeleton height={14} width="60%" />
                <Skeleton height={12} width="85%" />
                <Skeleton height={12} width="45%" />
              </View>
            </View>
          </Card>
        ) : null}
        {previewError ? <Text style={styles.err}>{previewError}</Text> : null}

        {preview ? (
          <Card style={styles.previewCard}>
            <View style={styles.previewTop}>
              <TokenLogo
                chainId={preview.chainId}
                address={preview.address}
                symbol={preview.symbol}
                size={64}
                logoUrl={preview.logoUrl}
              />
              <View style={styles.previewMid}>
                <Text style={styles.previewName} numberOfLines={1}>{preview.name}</Text>
                <Text style={styles.previewSub} numberOfLines={1}>
                  {preview.symbol} · {preview.decimals} decimals · {selectedChain.name}
                </Text>
                <Pressable
                  style={styles.previewAddrRow}
                  onPress={() => void Clipboard.setStringAsync(preview.address)}
                  hitSlop={6}
                >
                  <Text style={styles.previewAddr}>{shortAddress(preview.address)}</Text>
                  <Copy size={12} color={COLORS.textMuted} />
                </Pressable>
                <Text style={styles.previewPrice}>
                  {preview.priceUsd === null ? 'Price unavailable' : fmtPrice(preview.priceUsd)}
                </Text>
                {preview.verified ? (
                  <Text style={styles.registryOk}>✓ Verified in the Stelix registry</Text>
                ) : adminTokensSynced ? (
                  <Text style={styles.registryWarn}>Not in the Stelix registry — check the contract before importing.</Text>
                ) : null}
              </View>
            </View>
            {preview.logoUrl ? null : (
              <Text style={styles.logoWarn}>Logo not found — please check the contract address. Name and symbol were read from the contract.</Text>
            )}
            <Btn
              label={
                togglingKey === hiddenTokenKey(preview.chainId, preview.address)
                  ? 'Working…'
                  : activeKeys.has(hiddenTokenKey(preview.chainId, preview.address))
                    ? 'Deactivate token'
                    : 'Activate token'
              }
              onPress={() => void toggleRow(preview)}
              variant={
                activeKeys.has(hiddenTokenKey(preview.chainId, preview.address))
                  ? 'secondary'
                  : 'primary'
              }
              disabled={togglingKey !== null}
              style={styles.activateBtn}
            />
          </Card>
        ) : null}

        {mode === 'search' ? (
          <>
            {searching ? (
              <View accessibilityLabel="Searching tokens">
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.searchSkelRow}>
                    <Skeleton height={38} width={38} />
                    <View style={styles.searchSkelMid}>
                      <Skeleton height={13} width="45%" />
                      <Skeleton height={11} width="70%" />
                    </View>
                    <Skeleton height={11} width={44} />
                  </View>
                ))}
              </View>
            ) : null}
            {searchError ? <Text style={styles.err}>{searchError}</Text> : null}
            {!searching && !searchError && results.length === 0 && query.trim() !== '' && !isPartialContractAddress(query) ? (
              <Text style={styles.hint}>No tokens found for “{query.trim()}” on {selectedChain.name}.</Text>
            ) : null}
            {results.map((row) => {
              const k = hiddenTokenKey(row.chainId, row.address);
              const active = activeKeys.has(k);
              const alwaysOn = alwaysOnKeys.has(k);
              return (
                <Pressable key={k} style={styles.row} onPress={() => setDetail(row)}>
                  <TokenLogo chainId={row.chainId} address={row.address} symbol={row.symbol} size={38} logoUrl={row.logoUrl} fallbackTone="light" />
                  <View style={styles.rowMid}>
                    <Text style={styles.rowSymbol} numberOfLines={1}>
                      {row.symbol}
                      {row.verified ? ' ✓' : ''}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {row.name || row.chainId} · {row.priceUsd === null ? 'Price unavailable' : fmtPrice(row.priceUsd)}
                    </Text>
                  </View>
                  {alwaysOn ? (
                    <Text style={styles.alwaysOn}>Always on</Text>
                  ) : (
                    <Switch
                      value={active}
                      disabled={togglingKey !== null}
                      onValueChange={() => void toggleRow(row)}
                      trackColor={{ false: COLORS.border, true: COLORS.mint }}
                      thumbColor="#fff"
                    />
                  )}
                </Pressable>
              );
            })}
          </>
        ) : null}

        {msg ? <Text style={msgErr ? styles.err : styles.ok}>{msg}</Text> : null}
        <Text style={styles.foot}>Toggling a token off hides it from My Assets and remembers it — it will not reappear on refresh. Default stablecoins and registry tokens are always shown.</Text>
      </ScrollView>

      <BottomSheet visible={detail !== null} onClose={() => setDetail(null)} title={detail?.symbol ?? 'Token'}>
        {detail ? (
          <View>
            <View style={styles.detailTop}>
              <TokenLogo chainId={detail.chainId} address={detail.address} symbol={detail.symbol} size={64} logoUrl={detail.logoUrl} />
              <View style={styles.previewMid}>
                <Text style={styles.previewName} numberOfLines={1}>{detail.name}</Text>
                <Text style={styles.previewSub} numberOfLines={1}>
                  {detail.symbol} · {detail.decimals === null ? 'decimals unknown' : `${detail.decimals} decimals`} · {selectedChain.name}
                </Text>
                <Pressable
                  style={styles.previewAddrRow}
                  onPress={() => void Clipboard.setStringAsync(detail.address)}
                  hitSlop={6}
                >
                  <Text style={styles.previewAddr}>{shortAddress(detail.address)}</Text>
                  <Copy size={12} color={COLORS.textMuted} />
                </Pressable>
                <Text style={styles.previewPrice}>
                  {detail.priceUsd === null ? 'Price unavailable' : fmtPrice(detail.priceUsd)}
                </Text>
                {detail.verified ? (
                  <Text style={styles.registryOk}>✓ Verified in the Stelix registry</Text>
                ) : null}
              </View>
            </View>
            {detailAlwaysOn ? (
              <Text style={styles.hint}>This token is always shown in My Assets and cannot be hidden.</Text>
            ) : (
              <Btn
                label={
                  togglingKey === hiddenTokenKey(detail.chainId, detail.address)
                    ? 'Working…'
                    : detailActive
                      ? 'Deactivate token'
                      : 'Activate token'
                }
                onPress={() => void toggleRow(detail)}
                variant={detailActive ? 'secondary' : 'primary'}
                disabled={togglingKey !== null}
                style={styles.activateBtn}
              />
            )}
            <View style={styles.detailPad} />
          </View>
        ) : null}
      </BottomSheet>

      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  activateBtn: { marginTop: 12 },
  alwaysOn: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  chainChip: {
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chainChipSelected: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  chainChipText: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  chainChipTextSelected: { color: '#fff' },
  chainRow: { flexGrow: 0, marginTop: 12 },
  detailPad: { height: 24 },
  detailTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  err: { color: COLORS.red, fontSize: 12, lineHeight: 17, marginTop: 10 },
  foot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  inner: { padding: 12 },
  logoWarn: {
    backgroundColor: COLORS.amberSoft,
    borderRadius: 12,
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    padding: 10,
  },
  ok: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', marginTop: 10 },
  previewAddr: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  previewAddrRow: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 4 },
  previewCard: { marginTop: 12 },
  previewMid: { flex: 1, minWidth: 0 },
  previewSkelMid: { flex: 1, gap: 8, minWidth: 0 },
  previewName: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  previewPrice: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 4 },
  previewSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  previewTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  registryOk: { color: COLORS.mintDark, fontSize: 12, fontWeight: '700', marginTop: 6 },
  registryWarn: { color: '#B45309', fontSize: 12, marginTop: 6 },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  rowMid: { flex: 1, minWidth: 0 },
  searchSkelMid: { flex: 1, gap: 6, minWidth: 0 },
  searchSkelRow: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 10 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  rowSymbol: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  searchBox: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 12 },
  shell: { backgroundColor: COLORS.bg, flex: 1 },
});
