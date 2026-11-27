/**
 * Admin realtime sync — live polling, NOT push.
 *
 * The wallet polls GET /api/sync on the admin (default
 * https://stelix-admin.pages.dev, overridable with
 * EXPO_PUBLIC_ADMIN_API_URL) and re-applies state only when the server's
 * monotonic `version` changes. There is no websocket / push channel:
 * "live" here means the poll runs every ~45s while the app is open, on
 * foreground, on network-picker open, on pull-to-refresh, and on manual
 * refresh (see store/AppContext.tsx). An admin edit is therefore visible
 * within one poll interval — never after a 5-minute cache or a restart.
 *
 * What one /api/sync response carries:
 * - chains + deletedIds: the authoritative chain registry. A slug in
 *   `deletedIds` (chain tombstone) must NEVER reappear — not from the
 *   built-in fallback, not when the API is down. The last-seen tombstones
 *   and disabled-chain ids are persisted in kv storage
 *   (stelix.admin.deletedChains.v1 / stelix.admin.disabledChains.v1) and
 *   applied on top of the built-ins whenever the fetch fails.
 * - fees: the latest published fee config, or null when the admin has
 *   never published one. Null is an honest empty state: the wallet uses
 *   its local defaults and SAYS so (source 'default'), it never silently
 *   applies a hardcoded fee over an admin edit.
 * - announcements: unexpired public announcements (audience 'all' or a
 *   chain slug).
 * - config: the latest HMAC-signed app config, or null. The wallet trusts
 *   the server-reported `signatureValid` — the signing secret lives only
 *   on the server, so the wallet cannot verify the HMAC itself.
 * - tokens: the Token/DEX registry (allow/verified list).
 * - maintenance: maintenance mode (see isMaintenanceBlocking).
 *
 * fetchAdminSync() never throws: on ANY failure it returns null and the
 * wallet keeps its last-known state. It keeps only an in-flight dedup —
 * there is deliberately NO time-based cache any more (the old 5-minute
 * cache in adminChains.ts hid admin edits).
 */
import { getAdminApiBase, mergeAdminChains, type AdminChainRow } from './adminChains';
import { VAULT_DEFAULTS, type ChainConfig } from './chains';
import { kvGet, kvSet } from './storage';

export const ADMIN_POLL_INTERVAL_MS = 45_000;
const FETCH_TIMEOUT_MS = 8000;

export const DELETED_CHAINS_KEY = 'stelix.admin.deletedChains.v1';
export const DISABLED_CHAINS_KEY = 'stelix.admin.disabledChains.v1';
export const SYNC_VERSION_KEY = 'stelix.admin.syncVersion.v1';
export const NETWORK_MODE_KEY = 'stelix.admin.networkMode.v1';

/** Global testnet/mainnet mode, admin-controlled. null = the admin has
 *  never chosen: the wallet shows all networks, exactly as before. */
export type NetworkMode = 'testnet' | 'mainnet' | null;

/** Fee config as published by the admin (mirrors apps/admin/src/lib/fees.ts). */
export interface AdminFeeConfig {
  autoSellFeePct: number;
  minLockUsd: number;
  maxLockUsd: number;
  defaultPenaltyPct: number;
  twapMinutes: number;
  trailingStopOptions: string;
  defaultSlippagePct: number;
  penaltyDestination: 'burn' | 'treasury' | 'relock';
}

export interface AdminAnnouncement {
  id: number;
  title: string;
  message: string;
  audience: string;
  expires_at: string | null;
  created_at: string;
}

export interface AdminTokenEntry {
  id: number;
  symbol: string;
  chainId: string;
  address: string;
  decimals: number;
  verified: boolean;
  featured: boolean;
  /** Logo URL registered for this token in the admin (uploaded as a file
   *  from the Launchpad page, or the on-chain logoURI for a factory
   *  token). null = no registered logo — the wallet falls back to the
   *  public logo sources and the on-chain factory read. */
  logoUrl: string | null;
}

export interface AdminAppConfig {
  version: string;
  minAppVersion: string;
  forceUpgrade: boolean;
  flags: {
    bullLockAutoSell: boolean;
    trailingStop: boolean;
    yieldWhileLocked: boolean;
    groupLocks: boolean;
  };
  signatureValid: boolean;
  publishedAt: string;
}

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  scope: 'all' | 'wallet';
  updatedAt: string | null;
}

export const MAINTENANCE_OFF: MaintenanceState = {
  enabled: false,
  message: '',
  scope: 'wallet',
  updatedAt: null,
};

export interface AdminSyncData {
  version: number;
  chains: AdminChainRow[];
  deletedIds: string[];
  fees: AdminFeeConfig | null;
  feeVersion: number | null;
  announcements: AdminAnnouncement[];
  config: AdminAppConfig | null;
  tokens: AdminTokenEntry[];
  maintenance: MaintenanceState;
  /** Admin's global testnet/mainnet switch (null = never set). */
  networkMode: NetworkMode;
}

/** Last-seen tombstones / disabled ids, for the API-down fallback. */
export interface PersistedAdminChainState {
  deletedIds: string[];
  disabledIds: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v === 1 : fallback;
}

function parseFeeConfig(v: unknown): AdminFeeConfig | null {
  if (!isRecord(v)) return null;
  const autoSellFeePct = asNumber(v.autoSellFeePct);
  const minLockUsd = asNumber(v.minLockUsd);
  const maxLockUsd = asNumber(v.maxLockUsd);
  const defaultPenaltyPct = asNumber(v.defaultPenaltyPct);
  const twapMinutes = asNumber(v.twapMinutes);
  const defaultSlippagePct = asNumber(v.defaultSlippagePct);
  if (
    autoSellFeePct === null || minLockUsd === null || maxLockUsd === null ||
    defaultPenaltyPct === null || twapMinutes === null || defaultSlippagePct === null ||
    typeof v.trailingStopOptions !== 'string'
  ) {
    return null;
  }
  const dest = v.penaltyDestination;
  return {
    autoSellFeePct,
    minLockUsd,
    maxLockUsd,
    defaultPenaltyPct,
    twapMinutes,
    trailingStopOptions: v.trailingStopOptions,
    defaultSlippagePct,
    penaltyDestination: dest === 'burn' || dest === 'relock' ? dest : 'treasury',
  };
}

function parseAnnouncement(v: unknown): AdminAnnouncement | null {
  if (!isRecord(v)) return null;
  const id = asNumber(v.id);
  const title = asString(v.title);
  const message = asString(v.message);
  if (id === null || title === null || message === null) return null;
  return {
    id,
    title,
    message,
    audience: asString(v.audience) ?? 'all',
    expires_at: asString(v.expires_at),
    created_at: asString(v.created_at) ?? '',
  };
}

function parseToken(v: unknown): AdminTokenEntry | null {
  if (!isRecord(v)) return null;
  const id = asNumber(v.id);
  const symbol = asString(v.symbol);
  const chainId = asString(v.chain_id);
  const address = asString(v.address);
  const decimals = asNumber(v.decimals);
  if (id === null || symbol === null || chainId === null || address === null || decimals === null) return null;
  return {
    id,
    symbol,
    chainId,
    address,
    decimals,
    verified: asBool(v.verified, false),
    featured: asBool(v.featured, false),
    logoUrl: asString(v.logo_url),
  };
}

function parseAppConfig(v: unknown): AdminAppConfig | null {
  if (!isRecord(v)) return null;
  const version = asString(v.version);
  const payload = isRecord(v.payload) ? v.payload : null;
  if (version === null || payload === null) return null;
  const flags = isRecord(payload.flags) ? payload.flags : {};
  return {
    version,
    minAppVersion: asString(payload.minAppVersion) ?? '',
    forceUpgrade: asBool(payload.forceUpgrade, false),
    flags: {
      bullLockAutoSell: asBool(flags.bullLockAutoSell, true),
      trailingStop: asBool(flags.trailingStop, true),
      yieldWhileLocked: asBool(flags.yieldWhileLocked, false),
      groupLocks: asBool(flags.groupLocks, false),
    },
    signatureValid: asBool(v.signatureValid, false),
    publishedAt: asString(v.publishedAt) ?? '',
  };
}

function parseMaintenance(v: unknown): MaintenanceState {
  if (!isRecord(v)) return MAINTENANCE_OFF;
  return {
    enabled: asBool(v.enabled, false),
    message: asString(v.message) ?? '',
    scope: v.scope === 'all' ? 'all' : 'wallet',
    updatedAt: asString(v.updatedAt) ?? asString(v.updated_at),
  };
}

/**
 * Parse a GET /api/sync body. Returns null when the shape is wrong —
 * the caller then keeps its last-known state.
 */
export function parseAdminSync(body: unknown): AdminSyncData | null {
  if (!isRecord(body)) return null;
  const version = asNumber(body.version);
  if (version === null || !Array.isArray(body.chains)) return null;
  const chains = (body.chains as unknown[]).filter(
    (r): r is AdminChainRow => isRecord(r) && typeof r.id === 'string',
  );
  const deletedIds = Array.isArray(body.deletedIds)
    ? (body.deletedIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return {
    version,
    chains,
    deletedIds,
    fees: parseFeeConfig(body.fees),
    feeVersion: asNumber(body.feeVersion),
    announcements: Array.isArray(body.announcements)
      ? (body.announcements as unknown[]).map(parseAnnouncement).filter((a): a is AdminAnnouncement => a !== null)
      : [],
    config: parseAppConfig(body.config),
    tokens: Array.isArray(body.tokens)
      ? (body.tokens as unknown[]).map(parseToken).filter((t): t is AdminTokenEntry => t !== null)
      : [],
    maintenance: parseMaintenance(body.maintenance),
    networkMode: body.networkMode === 'mainnet' ? 'mainnet' : body.networkMode === 'testnet' ? 'testnet' : null,
  };
}

export async function loadPersistedAdminChainState(): Promise<PersistedAdminChainState> {
  const read = async (key: string): Promise<string[]> => {
    try {
      const raw = await kvGet(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  return { deletedIds: await read(DELETED_CHAINS_KEY), disabledIds: await read(DISABLED_CHAINS_KEY) };
}

/** Last-seen admin network mode, for restarts while the API is down. */
export async function loadPersistedNetworkMode(): Promise<NetworkMode> {
  try {
    const raw = await kvGet(NETWORK_MODE_KEY);
    return raw === 'mainnet' ? 'mainnet' : raw === 'testnet' ? 'testnet' : null;
  } catch {
    return null;
  }
}

async function persistAdminChainState(data: AdminSyncData): Promise<void> {
  const disabledIds = data.chains
    .filter((r) => r.active === 0 || r.active === false)
    .map((r) => r.id);
  try {
    await kvSet(DELETED_CHAINS_KEY, JSON.stringify(data.deletedIds));
    await kvSet(DISABLED_CHAINS_KEY, JSON.stringify(disabledIds));
    await kvSet(SYNC_VERSION_KEY, String(data.version));
    await kvSet(NETWORK_MODE_KEY, data.networkMode ?? '');
  } catch {
    // Persistence is best-effort; the in-memory state still applies.
  }
}

let inflight: Promise<AdminSyncData | null> | null = null;

/**
 * Fetch GET /api/sync. Returns the parsed payload on success, or null on
 * ANY failure (offline, timeout, non-200, bad JSON, wrong shape). Never
 * throws. Only concurrent duplicate calls share one request — there is
 * deliberately no time-based cache: every poll hits the server.
 */
export async function fetchAdminSync(): Promise<AdminSyncData | null> {
  if (inflight) return inflight;
  const run = (async (): Promise<AdminSyncData | null> => {
    const url = `${getAdminApiBase()}/api/sync`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return null;
      const data = parseAdminSync(await res.json());
      if (data) await persistAdminChainState(data);
      return data;
    } catch {
      return null;
    }
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    inflight = null;
  }
}

/** Test escape hatch for the in-flight dedup. */
export function clearAdminSyncCache(): void {
  inflight = null;
}

// ---------------------------------------------------------------------------
// Effective values: admin value when published, honest local default when not.
// ---------------------------------------------------------------------------

/** Local defaults, used ONLY when the admin has never published fees. */
export const DEFAULT_FEE_CONFIG: AdminFeeConfig = {
  autoSellFeePct: VAULT_DEFAULTS.autoSellFeeBps / 100,
  minLockUsd: 10,
  maxLockUsd: 100000,
  defaultPenaltyPct: 5,
  twapMinutes: 30,
  trailingStopOptions: 'Off, 10%, 15%, 20%',
  defaultSlippagePct: VAULT_DEFAULTS.slippageBps / 100,
  penaltyDestination: 'treasury',
};

export interface EffectiveFees {
  fees: AdminFeeConfig;
  /** 'admin' = published by the admin (this is live); 'default' = the admin
   *  has never published fees, so the wallet uses its local defaults and
   *  must SAY so in the UI. */
  source: 'admin' | 'default';
  version: number | null;
}

export function resolveEffectiveFees(adminFees: AdminFeeConfig | null, feeVersion: number | null): EffectiveFees {
  if (adminFees) return { fees: adminFees, source: 'admin', version: feeVersion };
  return { fees: DEFAULT_FEE_CONFIG, source: 'default', version: null };
}

/** Announcements for one chain: audience 'all' or the chain's own slug. */
export function visibleAnnouncements(all: AdminAnnouncement[], chainId: string): AdminAnnouncement[] {
  return all.filter((a) => a.audience === 'all' || a.audience === chainId);
}

/** Registry lookup: the token the user is about to import, if registered. */
export function findRegistryToken(
  tokens: AdminTokenEntry[],
  chainId: string,
  address: string,
): AdminTokenEntry | null {
  const want = address.trim().toLowerCase();
  return tokens.find((t) => t.chainId === chainId && t.address.trim().toLowerCase() === want) ?? null;
}

// ---------------------------------------------------------------------------
// Maintenance Mode
// ---------------------------------------------------------------------------

/** Any enabled maintenance blocks signing — the user must never be able
 *  to sign a transaction while maintenance is on, in either scope. */
export function maintenanceBlocksSigning(m: MaintenanceState): boolean {
  return m.enabled;
}

/** Scope 'all' additionally blocks the whole wallet behind a full
 *  maintenance screen; scope 'wallet' shows a banner and blocks on-chain
 *  actions while still allowing browsing. */
export function maintenanceBlocksApp(m: MaintenanceState): boolean {
  return m.enabled && m.scope === 'all';
}

/** "1.2.3" < "2.0.0" — for the force-upgrade flag in the signed config. */
export function isVersionBelow(have: string, minimum: string): boolean {
  const parse = (s: string): number[] => s.split('.').map((p) => Number(p) || 0);
  const a = parse(have);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Network mode (admin-controlled testnet / mainnet switch)
// ---------------------------------------------------------------------------

export function modeLabel(mode: NetworkMode): string {
  return mode === 'mainnet' ? 'Mainnet' : mode === 'testnet' ? 'Testnet' : 'All networks';
}

/** True when the chain is a testnet chain (explicit flag, else status). */
export function isTestnetChain(c: ChainConfig): boolean {
  return c.testnet === true || (c.testnet === undefined && c.status === 'testnet');
}

/**
 * Arc is ONE chain in the picker, never two. The registry keeps both
 * variants — 'arc' (testnet 5042002) and 'arc-mainnet' (mainnet 5042) —
 * as source data, but the user must never be able to pick Arc Mainnet
 * in the app. Which variant the single 'Arc' entry uses comes ONLY
 * from the admin network_mode: 'mainnet' => the mainnet variant,
 * anything else (null = admin never set a mode, or 'testnet') => the
 * testnet variant (testnet-first default). The picker therefore shows
 * exactly one Arc row, labelled with the mode it is on and "set by
 * admin". The mainnet variant still has vaultContract null, so vault
 * actions on Arc Mainnet still refuse honestly — the mode switch
 * never deploys a vault or bypasses the mainnet gate.
 */
export function collapseArcPair(chains: ChainConfig[], mode: NetworkMode): ChainConfig[] {
  const testnet = chains.find((c) => c.id === 'arc');
  const mainnet = chains.find((c) => c.id === 'arc-mainnet');
  if (!testnet || !mainnet) return [...chains];
  const variant = mode === 'mainnet' ? mainnet : testnet;
  const arc: ChainConfig = {
    ...variant,
    id: 'arc',
    name: 'Arc',
    isDefault: testnet.isDefault ?? mainnet.isDefault,
    pairedChainId: 'arc-mainnet',
  };
  return chains.filter((c) => c.id !== 'arc-mainnet').map((c) => (c.id === 'arc' ? arc : c));
}

/**
 * Chains visible under a mode. null (admin never chose) = all chains,
 * exactly as before. 'testnet' = testnet chains only; 'mainnet' = mainnet
 * chains only. The per-chain `active` flag still applies on top — this
 * only filters by testnet/mainnet. Arc is collapsed to ONE entry first
 * (see collapseArcPair): mode null/testnet => Arc testnet, mode mainnet
 * => Arc mainnet, never both in the list.
 */
export function filterChainsByMode(chains: ChainConfig[], mode: NetworkMode): ChainConfig[] {
  const collapsed = collapseArcPair(chains, mode);
  if (mode === null) return [...collapsed];
  const wantTestnet = mode === 'testnet';
  return collapsed.filter((c) => isTestnetChain(c) === wantTestnet);
}

/**
 * The chain the wallet should move to when the mode becomes `mode`, or
 * null when the current chain already fits (no switch needed). Prefers
 * the current chain's pair (arc ↔ arc-mainnet), then the default chain
 * of the new mode, then the first active chain of the new mode.
 */
export function pickChainForMode(
  chains: ChainConfig[],
  current: ChainConfig,
  mode: NetworkMode,
): ChainConfig | null {
  const visible = filterChainsByMode(chains, mode).filter((c) => c.active);
  // Arc is collapsed to one 'arc' entry: a current chain of
  // 'arc-mainnet' (picked before this change) is the Arc MAINNET
  // variant, so it only "fits" when the visible Arc entry is also
  // the mainnet variant (same chain id) — an id-only check would
  // wrongly say the mainnet chain already fits testnet mode.
  const currentVariant = current.id === 'arc-mainnet' ? { ...current, id: 'arc' } : current;
  if (
    visible.some(
      (c) => c.id === currentVariant.id && c.chainId === currentVariant.chainId && c.testnet === currentVariant.testnet,
    )
  ) {
    return null;
  }
  const pairId = current.pairedChainId === 'arc-mainnet' ? 'arc' : current.pairedChainId;
  const pair = pairId ? visible.find((c) => c.id === pairId) : undefined;
  if (pair) return pair;
  return visible.find((c) => c.isDefault) ?? visible[0] ?? null;
}

export interface ModeChangeDecision {
  /** True when the switch must wait for the in-progress transaction. */
  deferred: boolean;
  /** Chain to switch to now (null = stay on the current chain). */
  chain: ChainConfig | null;
  /** Notice to show the user, or null when nothing changed. */
  notice: string | null;
}

/**
 * Pure decision for a mode flip, used by AppContext and unit-tested.
 *
 * - Same mode as now: nothing to do.
 * - A transaction is in progress (signing modal open): DEFER. The mode
 *   is not applied and the chain is not switched; the caller stores the
 *   pending mode and applies it when the transaction finishes or is
 *   cancelled. The user is never switched mid-transaction.
 * - Otherwise: apply now and move to the pair/default chain of the new
 *   mode when the current chain does not fit.
 *
 * The switch is silent: notice is always null. The app never tells the
 * user about the admin, the mode source, or how the switch works — the
 * network simply changes (the picker and the Testnet/Mainnet badge show
 * the new state).
 *
 * Safety guard: switching mode never deploys anything and never bypasses
 * the mainnet gate — on a mainnet chain with no vault, locks/swaps still
 * refuse honestly (see lib/vault.ts resolveVaultAddress).
 */
export function resolveModeChange(args: {
  currentMode: NetworkMode;
  nextMode: NetworkMode;
  transactionActive: boolean;
  chains: ChainConfig[];
  currentChain: ChainConfig;
}): ModeChangeDecision {
  if (args.nextMode === args.currentMode) return { deferred: false, chain: null, notice: null };
  if (args.transactionActive) return { deferred: true, chain: null, notice: null };
  const chain = pickChainForMode(args.chains, args.currentChain, args.nextMode);
  return { deferred: false, chain, notice: null };
}

/** Merge helper for the API-down path: built-ins minus persisted
 *  tombstones, with persisted disabled ids forced off. */
export function mergeWithPersistedState(
  builtIn: ChainConfig[],
  persisted: PersistedAdminChainState,
): ReturnType<typeof mergeAdminChains> {
  return mergeAdminChains(builtIn, null, {
    deletedIds: persisted.deletedIds,
    disabledIds: persisted.disabledIds,
  });
}
