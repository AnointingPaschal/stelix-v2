/** Launchpad tab — live fixed-price token sales on Arc testnet.
 *  Free: no Stelix fee, gas only (Arc USDC gas). Lists launches from the
 *  admin D1 feed when configured, otherwise reads the launchpad contract
 *  on-chain. Until the contracts are deployed there are no launches at
 *  all — the screen shows the real empty state, never invented launches. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Plus, RefreshCw, Rocket } from 'lucide-react-native';
import { COLORS, FONT } from '../../theme';
import { useApp } from '../../store/AppContext';
import { fmtDateTime, fmtPrice, fmtUsd, shortAddress } from '../../lib/format';
import {
  LAUNCHPAD_EMPTY_STATE,
  LAUNCHPAD_FREE_NOTE,
  launchPhase,
  launchPhaseLabel,
  loadLaunches,
  microUsdcToUsd,
  progressBps,
  type LaunchSale,
} from '../../lib/launchpad';
import { Btn, Card, Chip, EmptyState, ProgressBar, ScreenHeader, SectionTitle } from '../../components/ui';
import { TokenLogo } from '../../components/TokenLogo';

function phaseTone(phase: string): 'mint' | 'amber' | 'muted' | 'red' | 'navy' {
  return phase === 'active' ? 'mint' : phase === 'upcoming' ? 'amber' : phase === 'success' ? 'navy' : phase === 'failed' ? 'red' : 'muted';
}

function LaunchCard({ sale, onPress }: { sale: LaunchSale; onPress: () => void }) {
  const phase = launchPhase(sale);
  const pct = progressBps(sale.raised, sale.hardCap);
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <TokenLogo chainId="arc" address={sale.token} symbol={sale.tokenSymbol || 'T'} size={40} logoUrl={sale.logoUrl} />
          <View style={styles.rowBody}>
            <Text style={styles.symbol}>{sale.tokenSymbol || shortAddress(sale.token)}</Text>
            <Text style={styles.name}>{sale.tokenName || shortAddress(sale.token)}</Text>
          </View>
          <Chip label={launchPhaseLabel(phase)} tone={phaseTone(phase)} />
        </View>
        <View style={styles.stats}>
          <View>
            <Text style={styles.label}>Price</Text>
            <Text style={styles.value}>{fmtPrice(microUsdcToUsd(sale.pricePerToken))}</Text>
          </View>
          <View>
            <Text style={styles.label}>Raised</Text>
            <Text style={styles.value}>
              {fmtUsd(microUsdcToUsd(sale.raised))} / {fmtUsd(microUsdcToUsd(sale.hardCap))}
            </Text>
          </View>
          <View>
            <Text style={styles.label}>Backers</Text>
            <Text style={styles.value}>{sale.contributors}</Text>
          </View>
        </View>
        <ProgressBar value={pct / 10000} />
        <Text style={styles.meta}>
          Soft cap {fmtUsd(microUsdcToUsd(sale.softCap))} · Ends {fmtDateTime(sale.endTime * 1000)}
          {sale.liquidityLockBps > 0 ? ` · Liquidity lock ${sale.liquidityLockBps / 100}%` : ''}
        </Text>
      </Card>
    </Pressable>
  );
}

export default function LaunchpadTab() {
  const { chain, address } = useApp();
  const [launches, setLaunches] = useState<LaunchSale[]>([]);
  const [deployed, setDeployed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await loadLaunches(chain.id, address || undefined);
      setDeployed(res.deployed);
      setLaunches(res.launches);
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [chain.id, address]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.inner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <ScreenHeader
        title="Launchpad"
        sub="Arc testnet · fixed-price sales"
        right={
          <Pressable onPress={() => { setRefreshing(true); void load(); }} hitSlop={8}>
            <RefreshCw size={18} color={COLORS.text} />
          </Pressable>
        }
      />

      <Card dark style={styles.freeCard}>
        <View style={styles.freeRow}>
          <Rocket size={18} color="#fff" />
          <Text style={styles.freeTitle}>Free to launch</Text>
        </View>
        <Text style={styles.freeBody}>
          {LAUNCHPAD_FREE_NOTE}. Gas is paid in USDC on Arc testnet — Stelix takes no cut of your sale.
        </Text>
      </Card>

      {chain.id !== 'arc' && (
        <Text style={styles.note}>Launchpad launches on Arc testnet. Switch your chain to Arc to launch or join a sale.</Text>
      )}

      <SectionTitle
        title={`Live launches (${launches.length})`}
        right={<Btn label="Create" variant="mint" onPress={() => router.push('/launchpad/create')} />}
      />

      {loading ? (
        <Text style={styles.note}>Loading launches…</Text>
      ) : !deployed ? (
        <EmptyState
          title="No launches yet"
          body={LAUNCHPAD_EMPTY_STATE}
          actionLabel="Create a Launch"
          onAction={() => router.push('/launchpad/create')}
        />
      ) : launches.length === 0 ? (
        <EmptyState
          title="No launches yet"
          body={LAUNCHPAD_EMPTY_STATE}
          actionLabel="Create a Launch"
          onAction={() => router.push('/launchpad/create')}
        />
      ) : (
        launches.map((s) => (
          <LaunchCard key={s.saleId} sale={s} onPress={() => router.push(`/launchpad/${s.saleId}`)} />
        ))
      )}

      {error && <Text style={styles.error}>Could not refresh launches: {error}</Text>}
      <Text style={styles.note}>
        Sales settle in USDC. If a sale misses its soft cap, contributors are refunded in full. Liquidity lock is pending Arc DEX
        confirmation — reserves stay in the launchpad until a liquidity manager is set.
      </Text>
      <Btn label="Create a Launch" variant="ghost" onPress={() => router.push('/launchpad/create')} style={styles.createBtn} />
      <View style={styles.plusRow}>
        <Plus size={14} color={COLORS.textMuted} />
        <Text style={styles.note}>Create a token, then launch it — both in one flow.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: COLORS.bg, flex: 1 },
  inner: { padding: 16, paddingBottom: 32 },
  freeCard: { marginTop: 12, padding: 14 },
  freeRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  freeTitle: { color: COLORS.textOnNavy, fontSize: FONT.title, fontWeight: '800' },
  freeBody: { color: COLORS.textOnNavyMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 6 },
  note: { color: COLORS.textMuted, fontSize: FONT.small, lineHeight: 18, marginTop: 12 },
  error: { color: COLORS.red, fontSize: FONT.small, lineHeight: 18, marginTop: 12 },
  card: { marginTop: 12, padding: 14 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  rowBody: { flex: 1 },
  symbol: { color: COLORS.text, fontSize: FONT.body, fontWeight: '800' },
  name: { color: COLORS.textMuted, fontSize: FONT.small, marginTop: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  label: { color: COLORS.textMuted, fontSize: FONT.label, fontWeight: '700' },
  value: { color: COLORS.text, fontSize: FONT.body, fontWeight: '700', marginTop: 2 },
  meta: { color: COLORS.textMuted, fontSize: FONT.small, marginTop: 10 },
  createBtn: { marginTop: 16 },
  plusRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 10 },
});
