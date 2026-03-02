const fs = require('fs')
const path = require('path')

const dataDir = path.join(__dirname, '..', 'data')
const dbFile = path.join(dataDir, 'databases.json')
const metricsFile = path.join(dataDir, 'metrics.json')

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf-8')
    return raw ? JSON.parse(raw) : fallback
  } catch (_) {
    return fallback
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj))
}

function now() {
  return new Date().toISOString()
}

function init() {
  ensureDir()
  const dbs = readJson(dbFile, [])
  const metrics = readJson(metricsFile, {})
  return { dbs, metrics }
}

function saveAll(dbs, metrics) {
  ensureDir()
  writeJson(dbFile, dbs)
  writeJson(metricsFile, metrics)
}

function upsertDb(dbs, record) {
  const idx = dbs.findIndex(x => x.id === record.id)
  if (idx >= 0) {
    dbs[idx] = { ...dbs[idx], ...record, updatedAt: now() }
  } else {
    dbs.push({ ...record, createdAt: now(), updatedAt: now() })
  }
}

function removeDb(dbs, id) {
  const idx = dbs.findIndex(x => x.id === id)
  if (idx >= 0) dbs.splice(idx, 1)
}

function pushMetric(metrics, id, point, keepHours) {
  if (!metrics[id]) metrics[id] = []
  metrics[id].push(point)
  const cutoff = Date.now() - keepHours * 3600 * 1000
  metrics[id] = metrics[id].filter(p => p.ts >= cutoff)
}

function rangeMetrics(metrics, id, fromTs, toTs) {
  const arr = metrics[id] || []
  return arr.filter(p => p.ts >= fromTs && p.ts <= toTs)
}

module.exports = {
  init,
  saveAll,
  upsertDb,
  removeDb,
  pushMetric,
  rangeMetrics,
}

