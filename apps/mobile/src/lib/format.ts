/** Formatting helpers (pure, no dependencies). */

export function fmtUsd(n: number, dp = 2): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

export function fmtNum(n: number, dp = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function fmtPct(n: number, dp = 1): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(dp)}%`;
}

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'] as const;

function subscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? '')
    .join('');
}

/** Token price in USD. Tiny prices use subscript notation instead of a
 *  wall of zeros: more than 5 zeros after the decimal point renders as
 *  $0.0₇6399 (0.00000006399) or $0.0₈1273 (0.000000001273). A true zero
 *  is always $0.00 — never $0.000000. Normal prices keep 2dp above $1
 *  ($553.10, $3.91) and 4dp below it ($0.0355). */
export function fmtPrice(n: number): string {
  if (n === 0) return '$0.00';
  if (!Number.isFinite(n)) return '—';
  if (n < 0) return `-${fmtPrice(-n)}`;
  if (n >= 1000) return fmtUsd(n, 2);
  if (n >= 1) return fmtUsd(n, 2);
  if (n >= 0.01) return fmtUsd(n, 4);
  if (n >= 0.000001) return `$${n.toFixed(6)}`; // at most 5 zeros — plain decimals
  const [mantissa, exp] = n.toExponential(3).split('e');
  const zeros = -Number(exp) - 1;
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  return `$0.0${subscript(zeros)}${digits}`;
}

export function shortAddress(addr: string, chars = 6): string {
  if (!addr || addr.length < chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`;
}

export function timeLeft(ms: number): string {
  if (ms <= 0) return 'Matured';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
