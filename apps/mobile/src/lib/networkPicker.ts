/**
 * Network picker options — pure, no React Native imports, unit-tested.
 *
 * The picker lists every ACTIVE chain from the merged admin registry,
 * Arc first (default). A coming-soon chain is SHOWN with a "Coming
 * soon" badge but is visibly disabled and can never be selected:
 * `disabled` rows ignore taps (see components/ui.tsx OptionSheet)
 * and `setChain` in store/AppContext.tsx refuses them as well, so a
 * coming-soon chain can never become the active chain even if a stale
 * option is tapped. The app never explains why a chain is coming
 * soon — no mention of the admin, the registry, or infrastructure.
 */
import { isChainUsable, type ChainConfig } from './chains';

export interface NetworkPickerOption {
  key: string;
  label: string;
  sub: string;
  selected: boolean;
  /** True when the row is shown disabled ("Coming soon"). */
  disabled: boolean;
  /** Badge text for disabled rows, undefined for usable rows. */
  badge?: string;
}

/** Build the picker rows for a chain list. `currentId` is the active
 *  chain (selected row). Disabled chains are never selected — if the
 *  current chain itself is coming-soon, no row is selected and the
 *  caller must fall back (see AppContext refreshAdmin). */
export function buildNetworkOptions(chains: ChainConfig[], currentId: string): NetworkPickerOption[] {
  return chains
    .filter((c) => c.active)
    .map((c) => {
      const usable = isChainUsable(c);
      const selected = usable && c.id === currentId;
      const sub =
        `${c.testnet ? 'Testnet' : 'Mainnet'} · Native: ${c.nativeSymbol}` +
        `${c.isDefault ? ' · Default' : ''}` +
        `${c.vaultContract ? '' : ' · Vault not deployed'}` +
        `${c.dexRouter ? ' · Router verified' : ''}`;
      return {
        key: c.id,
        label: c.name,
        sub,
        selected,
        disabled: !usable,
        badge: usable ? undefined : 'Coming soon',
      };
    });
}

/** The chain a tap may select, or null when the id is not a usable
 *  chain (coming-soon, disabled, or unknown). Pure guard used by the
 *  picker onSelect — the store's setChain guard is the second layer. */
export function selectableChain(chains: ChainConfig[], id: string): ChainConfig | null {
  const c = chains.find((x) => x.id === id);
  return c && isChainUsable(c) ? c : null;
}
