const BaseConnector = require('./base')
let oracledb
try {
  oracledb = require('oracledb')
} catch (e) {
  oracledb = null
}

const pools = new Map()
const prevStats = new Map() // id -> { ts, execCount }
const oracleClientState = { attempted: false, ok: false, error: null }

function ensureOracleClient(cfgOptions) {
  if (!oracledb || oracleClientState.attempted) return
  oracleClientState.attempted = true
  const opt = cfgOptions || {}
  const libDir =
    opt.oracleClientLibDir ||
    process.env.ORACLE_CLIENT_LIB_DIR ||
    process.env.OCI_LIB_DIR ||
    ''
  try {
    if (typeof oracledb.initOracleClient === 'function') {
      if (libDir) oracledb.initOracleClient({ libDir })
      else if (String(process.env.ORACLE_CLIENT_INIT || '').trim() === '1') oracledb.initOracleClient()
    }
    oracleClientState.ok = true
  } catch (e) {
    oracleClientState.error = e
  }
}

function isThinUnsupportedError(e) {
  const msg = String(e?.message || '')
  return msg.includes('NJS-138')
}

class OracleConnector extends BaseConnector {
  async testConnection() {
    if (!oracledb) return { ok: false, online: false, error: 'oracledb_not_installed' }
    const host = String(this.cfg.host || '').trim()
    const port = this.cfg.port ? Number(this.cfg.port) : 1521
    if (!host) return { ok: false, online: false, error: 'invalid_host' }
    if (!port || Number.isNaN(port)) return { ok: false, online: false, error: 'invalid_port' }

    const t0 = Date.now()
    let conn
    try {
      conn = await this._getConnection()
      await conn.execute('SELECT 1 AS val FROM dual')
      return { ok: true, online: true, latencyMs: Date.now() - t0 }
    } catch (e) {
      if (oracleClientState.error) {
        return { ok: false, online: false, error: 'oracle_client_init_failed', detail: String(oracleClientState.error?.message || oracleClientState.error) }
      }
      if (isThinUnsupportedError(e)) {
        return {
          ok: false,
          online: false,
          error: 'thin_mode_unsupported',
          detail: 'NJS-138: 当前数据库版本不支持 Thin 模式。请安装 Oracle Instant Client 并设置 ORACLE_CLIENT_LIB_DIR 指向其目录，然后重启服务进程。'
        }
      }
      return { ok: false, online: false, error: e && (e.code || 'connect_error'), detail: e && (e.message || '') }
    } finally {
      try { await conn?.close() } catch {}
    }
  }

  async collectMetrics() {
    if (!oracledb) throw new Error('oracledb_not_installed')
    const now = Date.now()
    const t0 = Date.now()
    const conn = await this._getConnection()
    try {
      let totalSessions = 0
      let activeSessions = 0
      let execCount = 0

      try {
        const r = await conn.execute(`SELECT COUNT(*) AS val FROM v$session WHERE type = 'USER'`)
        totalSessions = Number(r?.rows?.[0]?.VAL || r?.rows?.[0]?.val || 0)
      } catch (_) {
        totalSessions = 0
      }

      try {
        const r = await conn.execute(`SELECT COUNT(*) AS val FROM v$session WHERE type = 'USER' AND status = 'ACTIVE'`)
        activeSessions = Number(r?.rows?.[0]?.VAL || r?.rows?.[0]?.val || 0)
      } catch (_) {
        activeSessions = 0
      }

      try {
        const r = await conn.execute(`SELECT value AS val FROM v$sysstat WHERE name = 'execute count'`)
        execCount = Number(r?.rows?.[0]?.VAL || r?.rows?.[0]?.val || 0)
      } catch (_) {
        execCount = 0
      }

      let qps = 0
      const prev = prevStats.get(this.cfg.id)
      if (prev && execCount >= prev.execCount) {
        const dt = Math.max(1, (now - prev.ts) / 1000)
        qps = (execCount - prev.execCount) / dt
      }
      prevStats.set(this.cfg.id, { ts: now, execCount })

      return {
        sessions: totalSessions,
        qps,
        extra_data: JSON.stringify({ activeSessions }),
        resp_time: Date.now() - t0
      }
    } finally {
      try { await conn.close() } catch {}
    }
  }

  async _getConnection() {
    const pool = await this._getPool()
    const conn = await pool.getConnection()
    try {
      if (oracledb && oracledb.OUT_FORMAT_OBJECT) {
        conn.outFormat = oracledb.OUT_FORMAT_OBJECT
      }
    } catch (_) {}
    return conn
  }

  async _getPool() {
    if (!oracledb) throw new Error('oracledb_not_installed')
    ensureOracleClient(this.cfg?.options)
    if (oracleClientState.error) {
      const err = new Error(String(oracleClientState.error?.message || oracleClientState.error))
      err.code = 'oracle_client_init_failed'
      throw err
    }
    const key = this._poolKey()
    const existing = pools.get(key)
    if (existing) return existing
    const pool = await oracledb.createPool({
      user: this.cfg.user,
      password: this.cfg.password,
      connectString: this._connectString(),
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 60,
    })
    pools.set(key, pool)
    return pool
  }

  _connectString() {
    const opt = this.cfg.options || {}
    if (opt.connectString) return String(opt.connectString)
    const host = String(this.cfg.host || '').trim()
    const port = this.cfg.port ? Number(this.cfg.port) : 1521
    const serviceName = opt.serviceName ? String(opt.serviceName).trim() : ''
    const sn = serviceName || 'ORCL'
    return `${host}:${port}/${sn}`
  }

  _poolKey() {
    const host = this.cfg.host || ''
    const port = this.cfg.port || 1521
    const user = this.cfg.user || ''
    const pwd = this._hashSecret(this.cfg.password || '')
    const cs = this._connectString()
    const id = this.cfg.id || ''
    return `${id}|${host}|${port}|${user}|${pwd}|${cs}`
  }

  _hashSecret(s) {
    try {
      const crypto = require('crypto')
      return crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12)
    } catch (_) {
      return String(s || '').length ? 'set' : 'empty'
    }
  }
}

module.exports = OracleConnector
