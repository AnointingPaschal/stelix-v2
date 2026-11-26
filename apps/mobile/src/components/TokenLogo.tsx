/** TokenLogo — real token logo in a circle, letter fallback only while
 *  loading or when no source has a logo. Same 44px navy circle as the v1
 *  letter avatar, so rows keep their exact layout.
 *
 *  Resolution goes through lib/tokenLogos (Trust Wallet -> DexScreener ->
 *  GeckoTerminal -> CoinGecko -> token lists), cached in memory + local
 *  storage. A stored `logoUrl` (saved at import time, after the user saw
 *  the preview) wins over re-resolution. An <Image> onError also falls
 *  back to the letter — a broken remote image never shows as a blank
 *  circle. */
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';
import { getCachedLogo, resolveTokenLogo } from '../lib/tokenLogos';

export interface TokenLogoProps {
  chainId: string;
  /** '' = the chain's native asset. */
  address: string;
  symbol: string;
  /** Diameter in px. Defaults to the v1 avatar size (44). */
  size?: number;
  /** Logo URL already verified at import time — used as-is, no re-fetch. */
  logoUrl?: string | null;
  /** Letter-fallback tone: 'navy' (white letter, My Assets) or 'light'
   *  (dark letter on muted bg, Discover / Swap pickers). Default navy. */
  fallbackTone?: 'navy' | 'light';
}

export function useTokenLogo(
  chainId: string,
  address: string,
  logoUrl?: string | null,
): { uri: string | null; loading: boolean } {
  const [uri, setUri] = useState<string | null>(logoUrl ?? null);
  const [loading, setLoading] = useState(!logoUrl);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (logoUrl) {
      setUri(logoUrl);
      setLoading(false);
      return;
    }
    const cached = getCachedLogo(chainId, address);
    if (cached?.url) {
      setUri(cached.url);
      setLoading(false);
      return;
    }
    if (cached && cached.url === null) {
      // Known "no logo anywhere" — don't re-fetch, show the letter.
      setUri(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void resolveTokenLogo(chainId, address)
      .then((r) => {
        if (!cancelled && mounted.current) {
          setUri(r.url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled && mounted.current) {
          setUri(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, address, logoUrl]);

  return { uri, loading };
}

export function TokenLogo({ chainId, address, symbol, size = 44, logoUrl, fallbackTone = 'navy' }: TokenLogoProps) {
  const { uri } = useTokenLogo(chainId, address, logoUrl);
  const [failed, setFailed] = useState(false);

  // Reset the broken-image flag when the token changes.
  const key = `${chainId}:${address}:${uri ?? ''}`;
  const prevKey = useRef(key);
  if (prevKey.current !== key) {
    prevKey.current = key;
    if (failed) setFailed(false);
  }

  const letter = (symbol || '?').slice(0, 1).toUpperCase();
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
        onError={() => setFailed(true)}
        accessibilityLabel={`${symbol} logo`}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        fallbackTone === 'light' && styles.fallbackLight,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text
        style={[
          styles.letter,
          fallbackTone === 'light' && styles.letterLight,
          { fontSize: Math.max(12, Math.round(size * 0.36)) },
        ]}
      >
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    backgroundColor: COLORS.navy,
    justifyContent: 'center',
  },
  fallbackLight: {
    backgroundColor: COLORS.bgMuted,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  image: {
    backgroundColor: COLORS.bgMuted,
  },
  letter: { color: '#fff', fontWeight: '800' },
  letterLight: { color: COLORS.text },
});
