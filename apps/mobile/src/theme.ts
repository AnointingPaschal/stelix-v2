/** Stelix 2.0 design tokens — clean white background, dark navy surfaces,
 *  mint green accent for gains / target-hit. No emoji in UI; icons only. */
export const COLORS = {
  bg: '#FFFFFF',
  bgMuted: '#F1F5F9',
  navy: '#0B1220',
  navyCard: '#0F172A',
  navySoft: '#1E293B',
  text: '#0B1220',
  textMuted: '#64748B',
  textOnNavy: '#FFFFFF',
  textOnNavyMuted: '#94A3B8',
  mint: '#10B981',
  mintSoft: '#D1FAE5',
  mintDark: '#059669',
  gold: '#F5C400',
  red: '#EF4444',
  redSoft: '#FEE2E2',
  amber: '#F59E0B',
  border: '#E2E8F0',
  blue: '#2D72B7',
} as const;

export const RADIUS = { sm: 10, md: 16, lg: 20, xl: 24 } as const;

export const SHADOW = {
  card: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;
