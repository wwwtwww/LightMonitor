const BaseConnector = require('./base')
let mssql
try {
  mssql = require('mssql')
} catch (e) {
  mssql = null
}

const pools = new Map()
const prevCounters = new Map() // id -> { ts, batchRequests, compilations }
const extraCache = new Map() // id -> { ts, waitsPct, topWaitCategory, topWaitPct, diskReadLatencyMs, diskWriteLatencyMs, logWriteLatencyMs, agSyncLagSec, role }
const { shouldRefresh } = require('../utils/shouldRefresh')

function waitCategory(waitType) {
  const wt = String(waitType || '').toUpperCase()
  if (!wt) return 'OTHER'
  if (wt.startsWith('LCK_')) return 'LOCK'
  if (wt.startsWith('PAGEIOLATCH_') || wt === 'IO_COMPLETION' || wt.startsWith('ASYNC_IO_')) return 'IO'
  if (wt === 'WRITELOG' || wt.startsWith('LOGMGR') || wt.startsWith('LOGBUFFER') || wt.startsWith('LOG_RATE_')) return 'LOG'
  if (wt.startsWith('PAGELATCH_') || wt.startsWith('LATCH_')) return 'TEMPDB'
  if (wt === 'SOS_SCHEDULER_YIELD' || wt.startsWith('CX') || wt.startsWith('THREADPOOL')) return 'CPU'
  return 'OTHER'
}

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
  const connectTimeoutMs = Number.isFinite(Number(opt.connectTimeoutMs)) ? Number(opt.connectTimeoutMs) : 15000
  const requestTimeoutMs = Number.isFinite(Number(opt.requestTimeoutMs)) ? Number(opt.requestTimeoutMs) : 15000
  return {
    user: cfg.user,
    password: cfg.password,
    server: cfg.host,
    port: cfg.port ? Number(cfg.port) : 1433,
    database: opt.database || undefined,
    connectionTimeout: connectTimeoutMs,
    requestTimeout: requestTimeoutMs,
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

    const q = (sql) => pool.request().query(sql)

    const baseResults = await Promise.allSettled([
      q(`
        SELECT COUNT(*) AS val
        FROM sys.dm_exec_sessions
        WHERE is_user_process = 1
      `),
      q(`
        SELECT COUNT(*) AS val
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
        WHERE s.is_user_process = 1 AND r.session_id <> @@SPID
      `),
      q(`
        SELECT COUNT(*) AS val
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
        WHERE s.is_user_process = 1 AND r.blocking_session_id <> 0
      `),
      q(`
        SELECT counter_name, instance_name, cntr_value
        FROM sys.dm_os_performance_counters
        WHERE (counter_name IN ('Batch Requests/sec','SQL Compilations/sec') AND object_name LIKE '%SQL Statistics%')
           OR (counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%')
      `)
    ])
    const connRes = baseResults[0].status === 'fulfilled' ? baseResults[0].value : null
    const reqRes = baseResults[1].status === 'fulfilled' ? baseResults[1].value : null
    const blockRes = baseResults[2].status === 'fulfilled' ? baseResults[2].value : null
    const perfRes = baseResults[3].status === 'fulfilled' ? baseResults[3].value : null

    const connections = Number(connRes?.recordset?.[0]?.val || 0)
    const runningRequests = Number(reqRes?.recordset?.[0]?.val || 0)
    const blockingSessions = Number(blockRes?.recordset?.[0]?.val || 0)

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

    let waitsPct = { LOCK: 0, IO: 0, CPU: 0, LOG: 0, TEMPDB: 0, OTHER: 0 }
    let topWaitCategory = ''
    let topWaitPct = 0
    let diskReadLatencyMs = 0
    let diskWriteLatencyMs = 0
    let logWriteLatencyMs = 0
    const cached = extraCache.get(this.cfg.id)
    if (cached) {
      waitsPct = cached.waitsPct || waitsPct
      topWaitCategory = cached.topWaitCategory || topWaitCategory
      topWaitPct = Number.isFinite(Number(cached.topWaitPct)) ? Number(cached.topWaitPct) : topWaitPct
      diskReadLatencyMs = Number.isFinite(Number(cached.diskReadLatencyMs)) ? Number(cached.diskReadLatencyMs) : diskReadLatencyMs
      diskWriteLatencyMs = Number.isFinite(Number(cached.diskWriteLatencyMs)) ? Number(cached.diskWriteLatencyMs) : diskWriteLatencyMs
      logWriteLatencyMs = Number.isFinite(Number(cached.logWriteLatencyMs)) ? Number(cached.logWriteLatencyMs) : logWriteLatencyMs
    }
    const heavyIntervalMs = Number.isFinite(Number(this.cfg.options?.heavyIntervalMs)) ? Number(this.cfg.options?.heavyIntervalMs) : 30000
    const refreshSlowExtras = !cached || shouldRefresh(now, cached.ts, heavyIntervalMs)
    if (refreshSlowExtras) {
      const heavyResults = await Promise.allSettled([
        q(`
          SELECT TOP (200) wt.wait_type, wt.wait_duration_ms
          FROM sys.dm_os_waiting_tasks wt
          INNER JOIN sys.dm_exec_sessions s ON wt.session_id = s.session_id
          WHERE s.is_user_process = 1 AND wt.session_id <> @@SPID AND wt.wait_duration_ms > 0
          ORDER BY wt.wait_duration_ms DESC
        `),
        q(`
          SELECT
            SUM(vfs.num_of_reads) AS reads,
            SUM(vfs.io_stall_read_ms) AS read_stall_ms,
            SUM(vfs.num_of_writes) AS writes,
            SUM(vfs.io_stall_write_ms) AS write_stall_ms
          FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
        `),
        q(`
          SELECT
            SUM(vfs.num_of_writes) AS writes,
            SUM(vfs.io_stall_write_ms) AS stall_ms
          FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
          INNER JOIN sys.master_files mf
            ON vfs.database_id = mf.database_id AND vfs.file_id = mf.file_id
          WHERE mf.type = 1
        `),
        q(`
          SELECT TOP 1 role_desc AS val
          FROM sys.dm_hadr_availability_replica_states
          WHERE is_local = 1
        `),
        q(`
          SELECT
            MAX(CASE WHEN drs.redo_rate > 0 THEN (drs.redo_queue_size * 1.0) / drs.redo_rate ELSE NULL END) AS redo_lag_sec,
            MAX(CASE WHEN drs.log_send_rate > 0 THEN (drs.log_send_queue_size * 1.0) / drs.log_send_rate ELSE NULL END) AS send_lag_sec
          FROM sys.dm_hadr_database_replica_states drs
          INNER JOIN sys.dm_hadr_availability_replica_states ars ON drs.replica_id = ars.replica_id
          WHERE ars.is_local = 1
        `)
      ])

      const waitsRes = heavyResults[0].status === 'fulfilled' ? heavyResults[0].value : null
      const ioRes = heavyResults[1].status === 'fulfilled' ? heavyResults[1].value : null
      const logRes = heavyResults[2].status === 'fulfilled' ? heavyResults[2].value : null
      const roleRes = heavyResults[3].status === 'fulfilled' ? heavyResults[3].value : null
      const lagRes = heavyResults[4].status === 'fulfilled' ? heavyResults[4].value : null

      try {
        const rows = waitsRes?.recordset || []
        let total = 0
        const totals = { LOCK: 0, IO: 0, CPU: 0, LOG: 0, TEMPDB: 0, OTHER: 0 }
        for (const r of rows) {
          const ms = Number(r.wait_duration_ms || 0)
          if (!Number.isFinite(ms) || ms <= 0) continue
          total += ms
          const cat = waitCategory(r.wait_type)
          totals[cat] = (totals[cat] || 0) + ms
        }
        if (total > 0) {
          waitsPct = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(((v / total) * 100).toFixed(1))]))
          const top = Object.entries(waitsPct).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
          topWaitCategory = top?.[0] || ''
          topWaitPct = Number(top?.[1] || 0)
        }
      } catch {}
      try {
        const r = ioRes?.recordset?.[0] || {}
        const reads = Number(r.reads || 0)
        const readStall = Number(r.read_stall_ms || 0)
        const writes = Number(r.writes || 0)
        const writeStall = Number(r.write_stall_ms || 0)
        if (reads > 0) diskReadLatencyMs = Number((readStall / reads).toFixed(1))
        if (writes > 0) diskWriteLatencyMs = Number((writeStall / writes).toFixed(1))
      } catch {}
      try {
        const r = logRes?.recordset?.[0] || {}
        const writes = Number(r.writes || 0)
        const stall = Number(r.stall_ms || 0)
        if (writes > 0) logWriteLatencyMs = Number((stall / writes).toFixed(1))
      } catch {}

      let role = cached?.role || 'standalone'
      let agSyncLagSec = Number.isFinite(Number(cached?.agSyncLagSec)) ? Number(cached?.agSyncLagSec) : -1
      try {
        const r = String(roleRes?.recordset?.[0]?.val || '').toUpperCase()
        if (r === 'PRIMARY') role = 'master'
        else if (r === 'SECONDARY') role = 'slave'
        else if (r) role = 'standalone'
      } catch {}
      try {
        const r = lagRes?.recordset?.[0] || {}
        const redo = Number(r.redo_lag_sec)
        const send = Number(r.send_lag_sec)
        const v = Math.max(Number.isFinite(redo) ? redo : -1, Number.isFinite(send) ? send : -1)
        if (v >= 0) agSyncLagSec = Math.round(v)
      } catch {}

      extraCache.set(this.cfg.id, {
        ts: now,
        waitsPct,
        topWaitCategory,
        topWaitPct,
        diskReadLatencyMs,
        diskWriteLatencyMs,
        logWriteLatencyMs,
        agSyncLagSec,
        role
      })
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

    const latestCached = extraCache.get(this.cfg.id)
    const role = latestCached?.role || cached?.role || 'standalone'
    const agSyncLagSec = Number.isFinite(Number(latestCached?.agSyncLagSec))
      ? Number(latestCached?.agSyncLagSec)
      : (Number.isFinite(Number(cached?.agSyncLagSec)) ? Number(cached?.agSyncLagSec) : -1)

    return {
      sessions: connections,
      qps,
      role,
      threadsRunning: runningRequests,
      extra_data: JSON.stringify({
        ple,
        compilationsPerSec,
        blockingSessions,
        waitsPct,
        topWaitCategory,
        topWaitPct,
        diskReadLatencyMs,
        diskWriteLatencyMs,
        logWriteLatencyMs,
        agSyncLagSec
      }),
      resp_time: Date.now() - t0
    }
  }

  async getBlocking() {
    if (!mssql) throw new Error('mssql_not_installed')
    const pool = await getPool(this.cfg)
    try {
      const r = await pool.request().query(`
        SELECT
          r.session_id AS spid,
          r.blocking_session_id AS blocked_by,
          r.wait_time AS wait_ms,
          r.wait_type,
          DB_NAME(r.database_id) AS db_name,
          r.wait_resource,
          SUBSTRING(
            t.text,
            (r.statement_start_offset / 2) + 1,
            (
              (CASE WHEN r.statement_end_offset = -1 THEN DATALENGTH(t.text) ELSE r.statement_end_offset END - r.statement_start_offset) / 2
            ) + 1
          ) AS sql_text
        FROM sys.dm_exec_requests r
        INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
        CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE s.is_user_process = 1 AND r.blocking_session_id <> 0
        ORDER BY r.wait_time DESC
      `)
      return (r?.recordset || []).map(x => ({
        spid: Number(x.spid || 0),
        blockedBy: Number(x.blocked_by || 0),
        waitSeconds: Number(((Number(x.wait_ms || 0) || 0) / 1000).toFixed(0)),
        waitType: String(x.wait_type || ''),
        database: String(x.db_name || ''),
        resource: String(x.wait_resource || ''),
        sql: String(x.sql_text || '').trim()
      }))
    } catch {
      return []
    }
  }
}

SQLServerConnector._internal = { toSqlConfig, waitCategory }
module.exports = SQLServerConnector
