const BaseConnector = require('./base')
let mssql
try {
  mssql = require('mssql')
} catch (e) {
  mssql = null
}

const pools = new Map()
const prevCounters = new Map() // id -> { ts, batchRequests, compilations }

function hashSecret(s) {
  try {
    const crypto = require('crypto')
    return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12)
  } catch (_) {
    return String(s || '').length ? 'set' : 'empty'
  }
}

function poolKey(cfg) {
  const host = cfg.host || ''
  const port = cfg.port || 1433
  const user = cfg.user || ''
  const db = cfg.options?.database || ''
  const pwd = hashSecret(cfg.password || '')
  const id = cfg.id || ''
  return `${id}|${host}|${port}|${user}|${pwd}|${db}`
}

function toSqlConfig(cfg) {
  const opt = cfg.options || {}
  return {
    user: cfg.user,
    password: cfg.password,
    server: cfg.host,
    port: cfg.port ? Number(cfg.port) : 1433,
    database: opt.database || undefined,
    connectionTimeout: opt.connectTimeoutMs || 5000,
    requestTimeout: opt.requestTimeoutMs || 5000,
    pool: {
      max: 4,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: !!opt.encrypt,
      trustServerCertificate: opt.trustServerCertificate !== false,
      enableArithAbort: true,
    }
  }
}

async function getPool(cfg) {
  if (!mssql) throw new Error('mssql_not_installed')
  const key = poolKey(cfg)
  const existing = pools.get(key)
  if (existing && existing.connected) return existing
  const pool = new mssql.ConnectionPool(toSqlConfig(cfg))
  try { pool.on('error', () => {}) } catch (_) {}
  await pool.connect()
  pools.set(key, pool)
  return pool
}

class SQLServerConnector extends BaseConnector {
  async testConnection() {
    if (!mssql) return { ok: false, online: false, error: 'mssql_not_installed' }
    const host = String(this.cfg.host || '').trim()
    const port = this.cfg.port ? Number(this.cfg.port) : 1433
    if (!host) return { ok: false, online: false, error: 'invalid_host' }
    if (!port || Number.isNaN(port)) return { ok: false, online: false, error: 'invalid_port' }

    const t0 = Date.now()
    const pool = new mssql.ConnectionPool(toSqlConfig({ ...this.cfg, host, port }))
    try {
      await pool.connect()
      await pool.request().query('SELECT 1 AS val')
      return { ok: true, online: true, latencyMs: Date.now() - t0 }
    } catch (e) {
      return { ok: false, online: false, error: e && (e.code || 'connect_error'), detail: e && (e.message || '') }
    } finally {
      try { await pool.close() } catch {}
    }
  }

  async collectMetrics() {
    if (!mssql) throw new Error('mssql_not_installed')
    const pool = await getPool(this.cfg)
    const now = Date.now()
    const t0 = Date.now()

    const connRes = await pool.request().query(`
      SELECT COUNT(*) AS val
      FROM sys.dm_exec_sessions
      WHERE is_user_process = 1
    `)
    const connections = Number(connRes?.recordset?.[0]?.val || 0)

    const perfRes = await pool.request().query(`
      SELECT counter_name, instance_name, cntr_value
      FROM sys.dm_os_performance_counters
      WHERE (counter_name IN ('Batch Requests/sec','SQL Compilations/sec') AND object_name LIKE '%SQL Statistics%')
         OR (counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%')
    `)

    let batchRequests = 0
    let compilations = 0
    let ple = 0
    for (const r of (perfRes?.recordset || [])) {
      const name = String(r.counter_name || '')
      const v = Number(r.cntr_value || 0)
      if (name === 'Batch Requests/sec') batchRequests += v
      else if (name === 'SQL Compilations/sec') compilations += v
      else if (name === 'Page life expectancy') ple = Math.max(ple, v)
    }

    let qps = 0
    let compilationsPerSec = 0
    const prev = prevCounters.get(this.cfg.id)
    if (prev && batchRequests >= prev.batchRequests && compilations >= prev.compilations) {
      const dt = Math.max(1, (now - prev.ts) / 1000)
      qps = (batchRequests - prev.batchRequests) / dt
      compilationsPerSec = (compilations - prev.compilations) / dt
    }
    prevCounters.set(this.cfg.id, { ts: now, batchRequests, compilations })

    return {
      sessions: connections,
      qps,
      extra_data: JSON.stringify({
        ple,
        compilationsPerSec
      }),
      resp_time: Date.now() - t0
    }
  }
}

module.exports = SQLServerConnector
