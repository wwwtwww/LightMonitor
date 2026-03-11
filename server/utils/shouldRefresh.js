function shouldRefresh(nowTs, lastTs, intervalMs) {
  const n = Number(nowTs)
  const l = Number(lastTs)
  const i = Number(intervalMs)
  if (!Number.isFinite(i) || i <= 0) return true
  if (!Number.isFinite(l) || l <= 0) return true
  if (!Number.isFinite(n)) return true
  return (n - l) >= i
}

module.exports = { shouldRefresh }
