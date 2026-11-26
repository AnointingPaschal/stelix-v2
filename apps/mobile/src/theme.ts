/** Stelix 2.0 design tokens — v1 exactly.
 *  White bg, navy surfaces, mint accent. Grey text #64748B, light borders
 *  #E5E7EB, red #EF4444 only for warnings / wipe. No purple, no gradients
 *  except the subtle mint glow on the splash screen.
 *  Compact type scale: 11px labels, 12px small, 14px body, 16–18px titles,
 *  28–32px portfolio balance. Never 40px+ headings. */
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
  red: '#EF4444',
  redSoft: '#FEE2E2',
  amber: '#F59E0B',
  amberSoft: '#FEF3C7',
  border: '#E5E7EB',
  blue: '#2563EB',
} as const;

/** Compact type scale (v1). */
export const FONT = {
  label: 11,
  small: 12,
  body: 14,
  title: 16,
  screenTitle: 18,
  balance: 30,
} as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

export const SHADOW = {
  card: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
