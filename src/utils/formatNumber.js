export function formatNumber(value, digits = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '0'
  const d = Number.isFinite(Number(digits)) ? Math.max(0, Math.min(6, Number(digits))) : 0
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  }).format(n)
}

