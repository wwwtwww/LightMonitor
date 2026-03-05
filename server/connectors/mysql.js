const BaseConnector = require('./base')
let mysql
try {
  mysql = require('mysql2/promise')
} catch (e) {
  mysql = null
}

const pools = new Map()
const prevStats = new Map() // id -> { ts, queries, commits, rollbacks }

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
  const port = cfg.port || 3306
  const user = cfg.user || ''
  const db = cfg.options?.database || ''
  const pwd = hashSecret(cfg.password || '')
  const id = cfg.id || ''
  return `${id}|${host}|${port}|${user}|${pwd}|${db}`
}

function getPool(cfg) {
  if (!mysql) throw new Error('mysql2 not installed')
  const key = poolKey(cfg)
  if (pools.has(key)) return pools.get(key)
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password,
    database: cfg.options?.database || undefined,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true,
    connectTimeout: (cfg.options?.connectTimeoutMs) || 5000,
  })
  if (pool && pool.on) {
    try { pool.on('error', () => {}) } catch (_) {}
  }
  pools.set(key, pool)
  return pool
}

async function queryGlobalStatus(conn) {
  const names = ['Threads_connected', 'Threads_running', 'Queries', 'Com_commit', 'Com_rollback']
  const [rows] = await conn.query(`SHOW GLOBAL STATUS WHERE Variable_name IN (${names.map(()=>'?').join(',')})`, names)
  const map = {}
  for (const r of rows) map[r.Variable_name] = Number(r.Value)
  return {
    threadsConnected: map.Threads_connected ?? 0,
    threadsRunning: map.Threads_running ?? 0,
    queries: map.Queries ?? 0,
    commits: map.Com_commit ?? 0,
    rollbacks: map.Com_rollback ?? 0,
  }
}

class MySQLConnector extends BaseConnector {
  async testConnection() {
    if (!mysql) return { ok: false, online: false, error: 'mysql2_not_installed' }
    try {
      const pool = getPool(this.cfg)
      const t0 = Date.now()
      const conn = await pool.getConnection()
      try {
        await conn.ping()
        return { ok: true, online: true, latencyMs: Date.now() - t0 }
      } finally {
        conn.release()
      }
    } catch (e) {
      return { ok: false, online: false, error: e && (e.code || 'connect_error'), detail: e && (e.message || '') }
    }
  }

  async collectMetrics() {
    if (!mysql) throw new Error('mysql2_not_installed')
    const pool = getPool(this.cfg)
    const conn = await pool.getConnection()
    try {
      const s = await queryGlobalStatus(conn)
      const now = Date.now()
      const prev = prevStats.get(this.cfg.id)
      let qps = 0, tps = 0
      if (prev && s.queries >= prev.queries) {
        const dt = Math.max(1, (now - prev.ts) / 1000)
        qps = (s.queries - prev.queries) / dt
        const trx = (s.commits - prev.commits) + (s.rollbacks - prev.rollbacks)
        tps = trx / dt
      }
      prevStats.set(this.cfg.id, { ts: now, queries: s.queries, commits: s.commits, rollbacks: s.rollbacks })
      let slowCount = 0
      try {
        const [rows] = await conn.query(`
          SELECT SUM(COUNT_STAR) AS c
          FROM performance_schema.events_statements_summary_by_digest
          WHERE AVG_TIMER_WAIT >= 5000000000
        `)
        slowCount = Number(rows?.[0]?.c || 0)
      } catch (_) {
        slowCount = 0
      }

      let role = 'master'
      let slaveDelay = -1
      try {
        let [rStatus] = await conn.query('SHOW REPLICA STATUS').catch(() => [])
        if (!rStatus || rStatus.length === 0) {
          ;[rStatus] = await conn.query('SHOW SLAVE STATUS').catch(() => [])
        }
        if (rStatus && rStatus.length > 0) {
          role = 'slave'
          slaveDelay = rStatus[0].Seconds_Behind_Master
          if (slaveDelay === null || slaveDelay === undefined) slaveDelay = -1
        }
      } catch (_) {}

      return {
        sessions: s.threadsConnected,
        threadsRunning: s.threadsRunning,
        qps: Math.max(0, Number(qps.toFixed(2))),
        tps: Math.max(0, Number(tps.toFixed(2))),
        slowCount,
        role,
        slaveDelay: Number(slaveDelay)
      }
    } finally {
      conn.release()
    }
  }

  async getLocks() {
    if (!mysql) return { locks: [], waits: [] }
    try {
      const pool = getPool(this.cfg)
      const conn = await pool.getConnection()
      try {
        // 尝试使用 InnoDB 等待链（5.7 常见）
        const [rows] = await conn.query(`
          SELECT
            r.trx_mysql_thread_id AS waiting_thread,
            r.trx_started AS waiting_started,
            b.trx_mysql_thread_id AS blocking_thread,
            b.trx_started AS blocking_started
          FROM information_schema.innodb_lock_waits w
          JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
          JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
        `)
        if (rows.length) {
          // 补充用户/库名信息
          const [plist] = await conn.query(`SELECT id, user, host, db, time FROM information_schema.processlist`)
          const byId = new Map(plist.map(p => [p.id, p]))
          const waits = []
          const holders = new Map()
          for (const r of rows) {
            const holder = byId.get(r.blocking_thread) || {}
            const waiter = byId.get(r.waiting_thread) || {}
            holders.set(r.blocking_thread, {
              threadId: r.blocking_thread,
              user: holder.user || '',
              host: holder.host || '',
              db: holder.db || '',
              durationSec: Number(holder.time || 0),
              object: '',
            })
            waits.push({
              threadId: r.waiting_thread,
              user: waiter.user || '',
              host: waiter.host || '',
              db: waiter.db || '',
              waitingSec: Number(waiter.time || 0),
              blockedBy: r.blocking_thread,
            })
          }
          return { locks: Array.from(holders.values()), waits }
        }
        // 回退：列出等待锁的进程
        const [waiters] = await conn.query(`
          SELECT id AS threadId, user, host, db, time AS waitingSec, state
          FROM information_schema.processlist
          WHERE state LIKE 'Waiting for%lock%'
        `)
        return { locks: [], waits: waiters.map(x => ({ ...x, blockedBy: 0 })) }
      } finally {
        conn.release()
      }
    } catch (_) {
      return { locks: [], waits: [] }
    }
  }

  async killThread(threadId) {
    if (!mysql) return { ok: false, error: 'mysql2_not_installed' }
    try {
      const pool = getPool(this.cfg)
      const conn = await pool.getConnection()
      try {
        await conn.query(`KILL ?`, [Number(threadId)])
        return { ok: true, threadId }
      } finally {
        conn.release()
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  async topSlowQueries() {
    if (!mysql) return { data: [] }
    try {
      const pool = getPool(this.cfg)
      const conn = await pool.getConnection()
      try {
        const [rows] = await conn.query(`
          SELECT
            DIGEST_TEXT AS sql_text,
            COUNT_STAR AS cnt,
            AVG_TIMER_WAIT AS avg_wait,
            LAST_SEEN AS last_seen
          FROM performance_schema.events_statements_summary_by_digest
          WHERE DIGEST_TEXT IS NOT NULL
          ORDER BY AVG_TIMER_WAIT DESC
          LIMIT 10
        `)
        return rows.map((r, i) => ({
          rank: i + 1,
          sql: r.sql_text,
          avgLatencyMs: Math.round(Number(r.avg_wait || 0) / 1e9),
          count: Number(r.cnt || 0),
          lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
        }))
      } finally {
        conn.release()
      }
    } catch (_) {
      return []
    }
  }
}

module.exports = MySQLConnector
