const BaseConnector = require('./base')
let oracledb
try {
  oracledb = require('oracledb')
} catch (e) {
  oracledb = null
}

const pools = new Map()
const prevStats = new Map() // id -> { ts, execCount, auxTs, tablespaceMaxUsed, fraUsed }
const oracleClientState = { attempted: false, ok: false, error: null }

function firstVal(r) {
  try {
    const row = r?.rows?.[0]
    if (!row) return null
    if (row.VAL !== undefined) return row.VAL
    if (row.val !== undefined) return row.val
    const k = Object.keys(row)[0]
    return k ? row[k] : null
  } catch {
    return null
  }
}

function toNum(v, fallback = null) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

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
      let lockWaitSessions = -1
      let blockingSessions = -1
      let tablespaceMaxUsed = -1
      let fraUsed = -1

      try {
        const r = await conn.execute(`SELECT COUNT(*) AS val FROM v$session WHERE type = 'USER'`)
        totalSessions = toNum(firstVal(r), 0)
      } catch (_) {
        totalSessions = 0
      }

      try {
        const r = await conn.execute(`SELECT COUNT(*) AS val FROM v$session WHERE type = 'USER' AND status = 'ACTIVE'`)
        activeSessions = toNum(firstVal(r), 0)
      } catch (_) {
        activeSessions = 0
      }

      try {
        const r = await conn.execute(`SELECT value AS val FROM v$sysstat WHERE name = 'execute count'`)
        execCount = toNum(firstVal(r), 0)
      } catch (_) {
        execCount = 0
      }

      let qps = 0
      const prev = prevStats.get(this.cfg.id)
      if (prev && execCount >= prev.execCount) {
        const dt = Math.max(1, (now - prev.ts) / 1000)
        qps = (execCount - prev.execCount) / dt
      }
      const nextPrev = { ...(prev || {}), ts: now, execCount }

      try {
        const r = await conn.execute(`
          SELECT COUNT(*) AS val
          FROM v$session
          WHERE type = 'USER'
            AND blocking_session IS NOT NULL
            AND wait_class <> 'Idle'
        `)
        lockWaitSessions = toNum(firstVal(r), -1)
      } catch (_) {
        lockWaitSessions = -1
      }

      try {
        const r = await conn.execute(`
          SELECT COUNT(DISTINCT sid) AS val
          FROM v$session
          WHERE type = 'USER'
            AND sid IN (
              SELECT DISTINCT blocking_session
              FROM v$session
              WHERE type = 'USER' AND blocking_session IS NOT NULL
            )
        `)
        blockingSessions = toNum(firstVal(r), -1)
      } catch (_) {
        blockingSessions = -1
      }

      const needAux = !nextPrev.auxTs || (now - Number(nextPrev.auxTs || 0)) >= 60000
      if (!needAux) {
        tablespaceMaxUsed = toNum(nextPrev.tablespaceMaxUsed, -1)
        fraUsed = toNum(nextPrev.fraUsed, -1)
      } else {
        try {
          const r = await conn.execute(`SELECT MAX(used_percent) AS val FROM dba_tablespace_usage_metrics`)
          tablespaceMaxUsed = toNum(firstVal(r), -1)
        } catch (_) {
          tablespaceMaxUsed = -1
        }
        try {
          const r = await conn.execute(`
            SELECT
              CASE WHEN space_limit > 0 THEN (space_used / space_limit) * 100 ELSE NULL END AS val
            FROM v$recovery_file_dest
          `)
          fraUsed = toNum(firstVal(r), -1)
        } catch (_) {
          fraUsed = -1
        }
        nextPrev.auxTs = now
        nextPrev.tablespaceMaxUsed = tablespaceMaxUsed
        nextPrev.fraUsed = fraUsed
      }

      prevStats.set(this.cfg.id, nextPrev)

      return {
        sessions: totalSessions,
        qps,
        lockWaitSessions,
        blockingSessions,
        tablespaceMaxUsed,
        fraUsed,
        extra_data: JSON.stringify({ activeSessions }),
        resp_time: Date.now() - t0
      }
    } finally {
      try { await conn.close() } catch {}
    }
  }

  async getLocks() {
    if (!oracledb) throw new Error('oracledb_not_installed')
    const conn = await this._getConnection()
    try {
      let rows = []
      try {
        const r = await conn.execute(`
          SELECT
            s.sid AS sid,
            s.serial# AS serial,
            s.blocking_session AS blocking_sid,
            s.seconds_in_wait AS wait_seconds,
            s.event AS event,
            s.sql_id AS sql_id,
            o.owner AS owner,
            o.object_name AS object_name
          FROM v$session s
          LEFT JOIN v$locked_object lo ON lo.session_id = s.sid
          LEFT JOIN dba_objects o ON o.object_id = lo.object_id
          WHERE s.type = 'USER'
            AND s.blocking_session IS NOT NULL
            AND s.wait_class <> 'Idle'
          ORDER BY s.seconds_in_wait DESC
        `)
        rows = Array.isArray(r?.rows) ? r.rows : []
      } catch {
        rows = []
      }
      const waits = rows.map(x => ({
        sid: toNum(x?.SID ?? x?.sid, null),
        serial: toNum(x?.SERIAL ?? x?.serial, null),
        blockedBy: toNum(x?.BLOCKING_SID ?? x?.blocking_sid, null),
        waitingSec: toNum(x?.WAIT_SECONDS ?? x?.wait_seconds, 0),
        event: String(x?.EVENT ?? x?.event ?? ''),
        sqlId: String(x?.SQL_ID ?? x?.sql_id ?? ''),
        object: (() => {
          const owner = String(x?.OWNER ?? x?.owner ?? '').trim()
          const name = String(x?.OBJECT_NAME ?? x?.object_name ?? '').trim()
          if (!owner && !name) return ''
          if (!owner) return name
          if (!name) return owner
          return `${owner}.${name}`
        })()
      }))
      return { waits }
    } finally {
      try { await conn.close() } catch {}
    }
  }

  async getCapacity() {
    if (!oracledb) throw new Error('oracledb_not_installed')
    const conn = await this._getConnection()
    try {
      let tablespaces = []
      try {
        const r = await conn.execute(`
          SELECT
            m.tablespace_name AS tablespace_name,
            m.used_percent AS used_percent,
            (m.used_space * t.block_size) AS used_bytes,
            ((m.tablespace_size - m.used_space) * t.block_size) AS free_bytes,
            t.block_size AS block_size
          FROM dba_tablespace_usage_metrics m
          JOIN dba_tablespaces t ON t.tablespace_name = m.tablespace_name
          ORDER BY m.used_percent DESC
        `)
        const rows = Array.isArray(r?.rows) ? r.rows : []
        tablespaces = rows.map(x => ({
          name: String(x?.TABLESPACE_NAME ?? x?.tablespace_name ?? ''),
          usedPercent: toNum(x?.USED_PERCENT ?? x?.used_percent, -1),
          usedBytes: toNum(x?.USED_BYTES ?? x?.used_bytes, -1),
          freeBytes: toNum(x?.FREE_BYTES ?? x?.free_bytes, -1),
          blockSize: toNum(x?.BLOCK_SIZE ?? x?.block_size, -1)
        }))
      } catch (_) {
        tablespaces = []
      }

      let fra = null
      try {
        const r = await conn.execute(`
          SELECT
            space_limit AS space_limit,
            space_used AS space_used,
            space_reclaimable AS space_reclaimable,
            number_of_files AS number_of_files
          FROM v$recovery_file_dest
        `)
        const row = r?.rows?.[0] || null
        if (row) {
          const limit = toNum(row?.SPACE_LIMIT ?? row?.space_limit, 0)
          const used = toNum(row?.SPACE_USED ?? row?.space_used, 0)
          const reclaim = toNum(row?.SPACE_RECLAIMABLE ?? row?.space_reclaimable, 0)
          const files = toNum(row?.NUMBER_OF_FILES ?? row?.number_of_files, 0)
          const usedPercent = limit > 0 ? (used / limit) * 100 : -1
          fra = { spaceLimit: limit, spaceUsed: used, spaceReclaimable: reclaim, numberOfFiles: files, usedPercent }
        }
      } catch (_) {
        fra = null
      }

      return { tablespaces, fra }
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
