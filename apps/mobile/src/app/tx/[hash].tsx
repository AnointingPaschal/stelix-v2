/** Transaction Details — opened by tapping any row in History.
 *  Shows the full record: type, status, amount + USD value, date and
 *  time, from / to (tap to copy), network, block number, network fee
 *  and the transaction hash (tap to copy), plus View on explorer.
 *
 *  The fee is read live from Blockscout on Arc (keyless v2 API,
 *  /api/v2/transactions/{hash}: gas_used x gas_price, in wei) — the
 *  stored history record does not carry a fee. On other chains the
 *  fee shows "—" until their history source carries it. Nothing here
 *  is invented: a value the chain did not return shows "—". */
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ArrowDown, ArrowUp, Check, ChevronLeft, Copy, ExternalLink } from 'lucide-react-native';
import { COLORS } from '../../theme';
import { BottomNav } from '../../components/AppShell';
import { Skeleton } from '../../components/ui';
import { useApp } from '../../store/AppContext';
import { EVM_NATIVE_RPC_DECIMALS, getChain } from '../../lib/chains';
import { fmtDateTime, fmtNum, fmtUsd, shortAddress } from '../../lib/format';
import type { TxRecord } from '../../lib/history';

const BLOCKSCOUT_CHAIN_IDS = new Set(['arc-mainnet']);

function kindLabel(kind: TxRecord['kind']): string {
  switch (kind) {
    case 'received':
      return 'Token Received';
    case 'sent':
      return 'Token Sent';
    case 'swap':
      return 'Swap';
    case 'lock':
      return 'Locked';
    case 'unlock':
      return 'Unlocked';
    case 'break':
      return 'Lock broken';
    case 'claim':
      return 'Claimed';
    case 'approve':
      return 'Approved';
    case 'autosell':
      return 'Target hit — auto-sold';
    default:
      return 'Transaction';
  }
}

export default function TransactionDetail() {
  const { hash, chainId } = useLocalSearchParams<{ hash: string; chainId?: string }>();
  const { allHistory, tokens, address: myAddress } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [copied, setCopied] = useState<string | null>(null);
  const [feeNative, setFeeNative] = useState<string | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const tx = useMemo(
    () =>
      allHistory.find((t) => t.hash === hash && (!chainId || t.chainId === chainId)) ??
      allHistory.find((t) => t.hash === hash) ??
      null,
    [allHistory, hash, chainId],
  );
  const chain = useMemo(() => {
    try {
      return getChain(tx?.chainId ?? chainId ?? 'arc-mainnet');
    } catch {
      return getChain('arc-mainnet');
    }
  }, [tx?.chainId, chainId]);

  // Live fee from Blockscout on Arc (keyless). The stored record has no fee.
  useEffect(() => {
    if (!hash || !BLOCKSCOUT_CHAIN_IDS.has(chain.id)) return;
    let cancelled = false;
    setFeeLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    fetch(`${chain.explorerUrl.replace(/\/$/, '')}/api/v2/transactions/${hash}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (cancelled) return;
        const gasUsed = BigInt(j?.gas_used ?? '0');
        const gasPrice = BigInt(j?.gas_price ?? j?.max_fee_per_gas ?? '0');
        if (gasUsed > 0n && gasPrice > 0n) {
          const feeWei = gasUsed * gasPrice;
          const whole = feeWei / 10n ** BigInt(EVM_NATIVE_RPC_DECIMALS);
          const frac = feeWei % 10n ** BigInt(EVM_NATIVE_RPC_DECIMALS);
          setFeeNative(`${whole}.${frac.toString().padStart(EVM_NATIVE_RPC_DECIMALS, '0').replace(/0+$/, '') || '0'}`);
        }
      })
      .catch(() => {
        // Fee stays "—"; the rest of the page is the stored record.
      })
      .finally(() => {
        clearTimeout(t);
        if (!cancelled) setFeeLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [hash, chain.id, chain.explorerUrl]);

  async function copy(key: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  const received = tx?.kind === 'received' || tx?.kind === 'autosell' || tx?.kind === 'unlock';
  const tokenPrice = useMemo(() => {
    if (!tx) return null;
    const match = tokens.find((t) => t.symbol === tx.token && t.chainId === tx.chainId && t.priceUsd !== null);
    return match?.priceUsd ?? null;
  }, [tokens, tx]);
  const usd = tx?.usd ?? (tokenPrice !== null && tx ? tx.amount * tokenPrice : null);
  const status = tx?.status ?? 'confirmed';
  const dateText = tx && tx.at > 0 ? fmtDateTime(tx.at) : '—';

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueWrap}>{children}</View>
      </View>
    );
  }

  function Copyable({ label, value, display }: { label: string; value: string; display: string }) {
    return (
      <Pressable onPress={() => void copy(label, value)} style={styles.copyable} hitSlop={6}>
        <Text style={styles.value} numberOfLines={1}>
          {display}
        </Text>
        {copied === label ? <Check size={15} color={COLORS.mintDark} /> : <Copy size={15} color={COLORS.textMuted} />}
      </Pressable>
    );
  }

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
    >
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" style={styles.backBtn}>
          <ChevronLeft size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          Transaction Details
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {!tx ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Transaction not found</Text>
          <Text style={styles.emptyBody}>This transaction is not in this wallet&apos;s history on this device.</Text>
        </View>
      ) : (
        <>
          <View style={styles.hero}>
            <View style={[styles.icon, received ? styles.iconIn : styles.iconOut]}>
              {received ? <ArrowDown size={22} color={COLORS.mintDark} /> : <ArrowUp size={22} color={COLORS.text} />}
            </View>
            <Text style={[styles.amount, { color: received ? COLORS.mintDark : COLORS.text }]}>
              {received ? '+' : '-'}
              {fmtNum(tx.amount, 4)} {tx.token}
            </Text>
            <Text style={styles.usd}>{usd !== null ? fmtUsd(usd) : '—'}</Text>
            <View
              style={[
                styles.pill,
                status === 'confirmed'
                  ? styles.pillOk
                  : status === 'failed'
                    ? styles.pillBad
                    : status === 'unknown'
                      ? styles.pillMuted
                      : styles.pillWait,
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  status === 'confirmed'
                    ? styles.pillTextOk
                    : status === 'failed'
                      ? styles.pillTextBad
                      : status === 'unknown'
                        ? styles.pillTextMuted
                        : styles.pillTextWait,
                ]}
              >
                {status === 'confirmed' ? 'Confirmed' : status === 'failed' ? 'Failed' : status === 'unknown' ? 'Unknown' : 'Pending'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Row label="Type">
              <Text style={styles.value}>{kindLabel(tx.kind)}</Text>
            </Row>
            <Row label="Date">
              <Text style={styles.value}>{dateText}</Text>
            </Row>
            <Row label="From">
              <Copyable
                label="from"
                value={received ? (tx.counterparty ?? '') : myAddress}
                display={shortAddress(received ? (tx.counterparty ?? '') : myAddress, 6)}
              />
            </Row>
            <Row label="To">
              <Copyable
                label="to"
                value={received ? myAddress : (tx.counterparty ?? '')}
                display={shortAddress(received ? myAddress : (tx.counterparty ?? ''), 6)}
              />
            </Row>
            <Row label="Network">
              <Text style={styles.value}>
                {chain.name}
                {chain.testnet ? ' · Testnet' : ''}
              </Text>
            </Row>
            <Row label="Block">
              <Text style={styles.value}>{tx.blockNumber !== null ? String(tx.blockNumber) : '—'}</Text>
            </Row>
            <Row label="Network fee">
              {feeLoading ? (
                <Skeleton height={12} width={80} />
              ) : (
                <Text style={styles.value}>{feeNative !== null ? `${feeNative} ${chain.nativeSymbol}` : '—'}</Text>
              )}
            </Row>
            <Row label="Transaction hash">
              <Copyable label="hash" value={tx.hash} display={shortAddress(tx.hash, 8)} />
            </Row>
          </View>

          {tx.note ? <Text style={styles.note}>{tx.note}</Text> : null}
        </>
      )}

      <Pressable
        style={styles.explorerBtn}
        onPress={() => void Linking.openURL(`${chain.explorerUrl.replace(/\/$/, '')}/tx/${hash}`)}
      >
        <Text style={styles.explorerBtnText}>View on explorer</Text>
        <ExternalLink size={16} color="#fff" />
      </Pressable>
      <Pressable style={styles.copyBtn} onPress={() => void copy('hash', String(hash))}>
        <Text style={styles.copyBtnText}>{copied === 'hash' ? 'Hash copied' : 'Copy transaction hash'}</Text>
      </Pressable>
    </ScrollView>
    <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 26, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  backBtn: { alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  copyBtn: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    paddingVertical: 13,
  },
  copyBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  copyable: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24 },
  emptyBody: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  explorerBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 13,
  },
  explorerBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: 20 },
  icon: { alignItems: 'center', borderRadius: 999, height: 56, justifyContent: 'center', width: 56 },
  iconIn: { backgroundColor: COLORS.mintSoft },
  iconOut: { backgroundColor: COLORS.bgMuted },
  inner: { padding: 12 },
  label: { color: COLORS.textMuted, flexShrink: 0, fontSize: 13, width: 110 },
  note: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  pill: { borderRadius: 999, marginTop: 12, paddingHorizontal: 12, paddingVertical: 5 },
  pillBad: { backgroundColor: COLORS.redSoft },
  pillMuted: { backgroundColor: COLORS.bgMuted },
  pillOk: { backgroundColor: COLORS.mintSoft },
  pillText: { fontSize: 12, fontWeight: '700' },
  pillTextBad: { color: COLORS.red },
  pillTextMuted: { color: COLORS.textMuted },
  pillTextOk: { color: COLORS.mintDark },
  pillTextWait: { color: COLORS.amber },
  pillWait: { backgroundColor: COLORS.amberSoft },
  root: { backgroundColor: COLORS.bg, flex: 1 },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 13,
  },
  shell: { backgroundColor: COLORS.bg, flex: 1 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  usd: { color: COLORS.textMuted, fontSize: 14, marginTop: 4 },
  value: { color: COLORS.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  valueWrap: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
});
