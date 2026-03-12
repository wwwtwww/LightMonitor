const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { resolveDbPaths } = require('./dbpath')

const resolved = resolveDbPaths(__dirname, process.env, fs.existsSync)
const dataDir = resolved.dataDir
const dbPath = resolved.dbPath

let db

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function safeStatSize(p) {
  try {
    if (!fs.existsSync(p)) return 0
    return fs.statSync(p).size || 0
  } catch {
    return 0
  }
}

function safePragma(d, stmt, simple = true) {
  try {
    return d.pragma(stmt, { simple })
  } catch {
    return null
  }
}

function safeExplain(d, sql, params) {
  try {
    const st = d.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    return st.all(...(Array.isArray(params) ? params : []))
  } catch {
    return []
  }
}

function openDb() {
  if (db) return db
  ensureDir()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  try { db.pragma('synchronous = NORMAL') } catch {}
  try { db.pragma('temp_store = MEMORY') } catch {}
  try { db.pragma('cache_size = -65536') } catch {}
  try {
    const mmapMb = Number(process.env.DB_MMAP_MB || 512)
    if (Number.isFinite(mmapMb) && mmapMb > 0) db.pragma(`mmap_size = ${Math.floor(mmapMb * 1024 * 1024)}`)
  } catch {}
  try { db.pragma('wal_autocheckpoint = 1000') } catch {}
  try { db.pragma('busy_timeout = 5000') } catch {}
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      name TEXT,
      business_system TEXT,
      repl_role TEXT,
      remark TEXT,
      db_type TEXT,
      host TEXT,
      port INTEGER,
      user TEXT,
      password TEXT,
      options TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      status INTEGER,
      role TEXT,
      connections INTEGER,
      resp_time REAL,
      qps REAL,
      tps REAL,
      slave_delay INTEGER,
      slow_queries INTEGER,
      threads_running INTEGER,
      lock_wait_sessions INTEGER,
      blocking_sessions INTEGER,
      tablespace_max_used REAL,
      fra_used REAL,
      extra_data TEXT,
      created_at INTEGER,
      FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(created_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_target_time ON metrics(target_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_target_time_desc ON metrics(target_id, created_at DESC);
  `)
  
  // Migration for new columns
  try { db.exec(`ALTER TABLE targets ADD COLUMN business_system TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE targets ADD COLUMN repl_role TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE targets ADD COLUMN remark TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN slave_delay INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN role TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN extra_data TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN lock_wait_sessions INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN blocking_sessions INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN tablespace_max_used REAL`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN fra_used REAL`) } catch (_) {}
  try { db.exec(`UPDATE targets SET db_type = 'mssql' WHERE db_type = 'sqlserver'`) } catch (_) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(created_at)`) } catch (_) {}

  return db
}

function nowMs() {
  return Date.now()
}

function toRowTarget(r) {
  const obj = {
    id: r.id,
    name: r.name,
    business_system: r.business_system || '',
    repl_role: r.repl_role || '',
    remark: r.remark || '',
    type: r.db_type,
    host: r.host,
    port: r.port,
    user: r.user,
    password: r.password,
    options: r.options ? JSON.parse(r.options) : {}
  }
  return obj
}

function toApiMetric(r) {
  return {
    ts: r.created_at,
    online: !!r.status,
    role: r.role || '',
    sessions: r.connections || 0,
    resp_time: r.resp_time || 0,
    threadsRunning: r.threads_running || 0,
    qps: r.qps || 0,
    tps: r.tps || 0,
    slaveDelay: r.slave_delay ?? -1,
    slowCount: r.slow_queries || 0,
    lockWaitSessions: r.lock_wait_sessions ?? -1,
    blockingSessions: r.blocking_sessions ?? -1,
    tablespaceMaxUsed: r.tablespace_max_used ?? -1,
    fraUsed: r.fra_used ?? -1,
    extra_data: r.extra_data || ''
  }
}

function init() {
  openDb()
  return {}
}

function listTargets() {
  const d = openDb()
  const rows = d.prepare(`SELECT * FROM targets ORDER BY created_at ASC`).all()
  return rows.map(toRowTarget)
}

function getTarget(id) {
  const d = openDb()
  const r = d.prepare(`SELECT * FROM targets WHERE id = ?`).get(id)
  return r ? toRowTarget(r) : null
}

function insertTarget(rec) {
  const d = openDb()
  const ts = nowMs()
  d.prepare(`
    INSERT INTO targets(id, name, business_system, repl_role, remark, db_type, host, port, user, password, options, created_at, updated_at)
    VALUES(@id,@name,@business_system,@repl_role,@remark,@db_type,@host,@port,@user,@password,@options,@created_at,@updated_at)
  `).run({
    id: rec.id,
    name: rec.name || rec.host,
    business_system: rec.business_system || '',
    repl_role: rec.repl_role || '',
    remark: rec.remark || '',
    db_type: rec.type || rec.db_type,
    host: rec.host,
    port: rec.port || null,
    user: rec.user || '',
    password: rec.password || '',
    options: rec.options ? JSON.stringify(rec.options) : JSON.stringify({}),
    created_at: ts,
    updated_at: ts
  })
}

function updateTarget(id, patch) {
  const d = openDb()
  const cur = d.prepare(`SELECT * FROM targets WHERE id = ?`).get(id)
  if (!cur) return null
  const next = {
    name: patch.name ?? cur.name,
    business_system: patch.business_system ?? cur.business_system,
    repl_role: patch.repl_role ?? cur.repl_role,
    remark: patch.remark ?? cur.remark,
    db_type: (patch.type || patch.db_type) ?? cur.db_type,
    host: patch.host ?? cur.host,
    port: patch.port ?? cur.port,
    user: patch.user ?? cur.user,
    password: ('password' in patch) ? (patch.password ?? cur.password) : cur.password,
    options: patch.options ? JSON.stringify(patch.options) : (cur.options || JSON.stringify({})),
    updated_at: nowMs()
  }
  d.prepare(`
    UPDATE targets SET
      name=@name, business_system=@business_system, repl_role=@repl_role, remark=@remark, db_type=@db_type, host=@host, port=@port, user=@user, password=@password, options=@options, updated_at=@updated_at
    WHERE id=@id
  `).run({ id, ...next })
  const r = d.prepare(`SELECT * FROM targets WHERE id = ?`).get(id)
  return toRowTarget(r)
}

function deleteTarget(id) {
  const d = openDb()
  d.prepare(`DELETE FROM targets WHERE id = ?`).run(id)
}

function latestMetric(id) {
  const d = openDb()
  const r = d.prepare(`SELECT * FROM metrics WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`).get(id)
  return r ? toApiMetric(r) : null
}

function latestMetrics(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean).map(String) : []
  if (!list.length) return {}
  const d = openDb()
  const placeholders = list.map(() => '?').join(',')
  const rows = d.prepare(`
    SELECT m.*
    FROM metrics m
    INNER JOIN (
      SELECT target_id, MAX(created_at) AS created_at
      FROM metrics
      WHERE target_id IN (${placeholders})
      GROUP BY target_id
    ) g
      ON m.target_id = g.target_id AND m.created_at = g.created_at
  `).all(...list)
  const out = {}
  for (const r of rows) out[String(r.target_id)] = toApiMetric(r)
  return out
}

function insertMetric(targetId, point, keepHours) {
  const d = openDb()
  const ts = point.ts || nowMs()
  const extraData =
    (typeof point.extra_data === 'string' ? point.extra_data : null) ??
    (point.extra_data && typeof point.extra_data === 'object' ? JSON.stringify(point.extra_data) : null) ??
    (point.extraData && typeof point.extraData === 'object' ? JSON.stringify(point.extraData) : null) ??
    (typeof point.extraData === 'string' ? point.extraData : null) ??
    ''
  d.prepare(`
    INSERT INTO metrics(
      target_id, status, role, connections, resp_time, qps, tps, slave_delay, slow_queries, threads_running,
      lock_wait_sessions, blocking_sessions, tablespace_max_used, fra_used,
      extra_data, created_at
    )
    VALUES(
      @target_id,@status,@role,@connections,@resp_time,@qps,@tps,@slave_delay,@slow_queries,@threads_running,
      @lock_wait_sessions,@blocking_sessions,@tablespace_max_used,@fra_used,
      @extra_data,@created_at
    )
  `).run({
    target_id: targetId,
    status: point.online ? 1 : 0,
    role: point.role || '',
    connections: point.sessions || 0,
    resp_time: point.resp_time || 0,
    qps: point.qps || 0,
    tps: point.tps || 0,
    slave_delay: point.slaveDelay ?? -1,
    slow_queries: point.slowCount ?? point.slow_queries ?? 0,
    threads_running: point.threadsRunning ?? point.threads_running ?? 0,
    lock_wait_sessions: point.lockWaitSessions ?? point.lock_wait_sessions ?? -1,
    blocking_sessions: point.blockingSessions ?? point.blocking_sessions ?? -1,
    tablespace_max_used: point.tablespaceMaxUsed ?? point.tablespace_max_used ?? -1,
    fra_used: point.fraUsed ?? point.fra_used ?? -1,
    extra_data: extraData,
    created_at: ts
  })
}

function rangeMetrics(targetId, fromTs, toTs, options = {}) {
  const d = openDb()
  const maxPoints = Number(options.maxPoints)
  let stepMs = Number(options.stepMs)
  const span = Math.max(0, Number(toTs) - Number(fromTs))
  if ((!Number.isFinite(stepMs) || stepMs <= 0) && Number.isFinite(maxPoints) && maxPoints > 0 && span > 0) {
    stepMs = Math.ceil(span / Math.floor(maxPoints))
  }
  let rows
  if (Number.isFinite(stepMs) && stepMs > 0) {
    try {
      rows = d.prepare(`
        SELECT
          created_at, status, role, connections, resp_time, qps, tps, slave_delay, slow_queries, threads_running,
          lock_wait_sessions, blocking_sessions, tablespace_max_used, fra_used,
          extra_data
        FROM (
          SELECT
            created_at, status, role, connections, resp_time, qps, tps, slave_delay, slow_queries, threads_running,
            lock_wait_sessions, blocking_sessions, tablespace_max_used, fra_used,
            extra_data,
            ROW_NUMBER() OVER (PARTITION BY CAST(created_at / ? AS INTEGER) ORDER BY created_at DESC) AS rn
          FROM metrics
          WHERE target_id = ? AND created_at BETWEEN ? AND ?
        )
        WHERE rn = 1
        ORDER BY created_at ASC
      `).all(stepMs, targetId, fromTs, toTs)
    } catch {
      rows = d.prepare(`
        SELECT m.*
        FROM metrics m
        INNER JOIN (
          SELECT MAX(created_at) AS created_at
          FROM metrics
          WHERE target_id = ? AND created_at BETWEEN ? AND ?
          GROUP BY CAST(created_at / ? AS INTEGER)
        ) g
        ON m.target_id = ? AND m.created_at = g.created_at
        ORDER BY m.created_at ASC
      `).all(targetId, fromTs, toTs, stepMs, targetId)
    }
  } else {
    rows = d.prepare(`
      SELECT * FROM metrics
      WHERE target_id = ? AND created_at BETWEEN ? AND ?
      ORDER BY created_at ASC
    `).all(targetId, fromTs, toTs)
  }
  return rows.map(toApiMetric)
}

function cleanupBefore(ts) {
  const d = openDb()
  d.prepare(`DELETE FROM metrics WHERE created_at < ?`).run(ts)
}

function getDbPath() {
  return dbPath
}

function getConfig(key) {
  const d = openDb()
  const r = d.prepare(`SELECT value FROM system_config WHERE key = ?`).get(String(key))
  return r ? String(r.value ?? '') : null
}

function setConfig(key, value) {
  const d = openDb()
  d.prepare(`INSERT INTO system_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(String(key), String(value ?? ''))
}

function getMaintenanceConfig() {
  const retentionDays = Number(getConfig('retention_days') ?? '')
  const cleanupTime = String(getConfig('cleanup_time') ?? '').trim()
  return {
    retention_days: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 7,
    cleanup_time: /^\d{2}:\d{2}$/.test(cleanupTime) ? cleanupTime : '03:00'
  }
}

function getMaintenanceStats(options = {}) {
  const d = openDb()
  const dbSizeBytes = safeStatSize(dbPath)
  const walSizeBytes = safeStatSize(`${dbPath}-wal`)
  const shmSizeBytes = safeStatSize(`${dbPath}-shm`)
  const includeCounts = options.includeCounts === true
  const metricsRows = includeCounts ? Number(d.prepare(`SELECT COUNT(1) AS c FROM metrics`).get()?.c || 0) : null
  const targetsRows = Number(d.prepare(`SELECT COUNT(1) AS c FROM targets`).get()?.c || 0)
  return {
    dbPath,
    dbSizeBytes,
    walSizeBytes,
    shmSizeBytes,
    totalSizeBytes: dbSizeBytes + walSizeBytes + shmSizeBytes,
    metricsRows,
    targetsRows
  }
}

function getDbDiagnostics(options = {}) {
  const d = openDb()
  const includeCounts = options.includeCounts === true
  const s = getMaintenanceStats({ includeCounts })
  const totalSizeBytes = (s.dbSizeBytes || 0) + (s.walSizeBytes || 0) + (s.shmSizeBytes || 0)

  const pragmas = {
    journal_mode: safePragma(d, 'journal_mode'),
    synchronous: safePragma(d, 'synchronous'),
    temp_store: safePragma(d, 'temp_store'),
    cache_size: safePragma(d, 'cache_size'),
    page_size: safePragma(d, 'page_size'),
    wal_autocheckpoint: safePragma(d, 'wal_autocheckpoint'),
    busy_timeout: safePragma(d, 'busy_timeout'),
    foreign_keys: safePragma(d, 'foreign_keys'),
    auto_vacuum: safePragma(d, 'auto_vacuum')
  }

  const idxMetrics = safePragma(d, `index_list('metrics')`, false) || []
  const idxTargets = safePragma(d, `index_list('targets')`, false) || []

  const walCheckpoint = safePragma(d, 'wal_checkpoint(PASSIVE)', false)

  const targetId = String(options.targetId || '')
  const now = Date.now()
  const toTs = Number.isFinite(Number(options.toTs)) ? Number(options.toTs) : now
  const fromTs = Number.isFinite(Number(options.fromTs)) ? Number(options.fromTs) : (toTs - 3600 * 1000)
  const maxPoints = Number.isFinite(Number(options.maxPoints)) ? Math.floor(Number(options.maxPoints)) : 720
  let stepMs = Number(options.stepMs)
  const span = Math.max(0, toTs - fromTs)
  if ((!Number.isFinite(stepMs) || stepMs <= 0) && Number.isFinite(maxPoints) && maxPoints > 0 && span > 0) stepMs = Math.ceil(span / Math.floor(maxPoints))
  if (!Number.isFinite(stepMs) || stepMs <= 0) stepMs = 0

  const plans = {}
  if (targetId) {
    plans.latestMetric = safeExplain(d, `SELECT * FROM metrics WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`, [targetId])
    if (stepMs > 0) {
      plans.rangeMetricsSample = safeExplain(d, `
        SELECT m.*
        FROM metrics m
        INNER JOIN (
          SELECT MAX(created_at) AS created_at
          FROM metrics
          WHERE target_id = ? AND created_at BETWEEN ? AND ?
          GROUP BY CAST(created_at / ? AS INTEGER)
        ) g
        ON m.target_id = ? AND m.created_at = g.created_at
        ORDER BY m.created_at ASC
      `, [targetId, fromTs, toTs, stepMs, targetId])
    } else {
      plans.rangeMetricsSample = safeExplain(d, `SELECT * FROM metrics WHERE target_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at ASC`, [targetId, fromTs, toTs])
    }
  }

  return {
    dbPath: s.dbPath,
    sizes: {
      dbSizeBytes: s.dbSizeBytes || 0,
      walSizeBytes: s.walSizeBytes || 0,
      shmSizeBytes: s.shmSizeBytes || 0,
      totalSizeBytes
    },
    counts: (includeCounts && Number.isFinite(Number(s.metricsRows))) ? {
      metricsRows: s.metricsRows,
      targetsRows: s.targetsRows
    } : null,
    pragmas,
    walCheckpoint,
    indexes: {
      metrics: idxMetrics,
      targets: idxTargets
    },
    explain: {
      targetId: targetId || null,
      fromTs,
      toTs,
      stepMs,
      maxPoints,
      plans
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cleanupOldMetrics(options = {}) {
  const d = openDb()
  const n = Number(options.days)
  const keepDays = Number.isFinite(n) && n > 0 ? Math.floor(n) : 7
  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
  const batchSize = Number.isFinite(Number(options.batchSize)) && Number(options.batchSize) > 0 ? Math.floor(Number(options.batchSize)) : 5000
  const yieldMs = Number.isFinite(Number(options.yieldMs)) && Number(options.yieldMs) >= 0 ? Math.floor(Number(options.yieldMs)) : 0
  const vacuum = options.vacuum === true
  const walTruncate = options.walTruncate !== false

  const before = getMaintenanceStats({ includeCounts: false })

  const delStmt = d.prepare(`
    DELETE FROM metrics
    WHERE id IN (
      SELECT id FROM metrics
      WHERE created_at < ?
      ORDER BY created_at
      LIMIT ?
    )
  `)

  let deletedRows = 0
  while (true) {
    const r = delStmt.run(cutoff, batchSize)
    const changes = r?.changes ?? 0
    deletedRows += changes
    if (changes <= 0) break
    if (yieldMs > 0) await sleep(yieldMs)
    else await sleep(0)
  }

  let vacuumRan = false
  if (walTruncate) {
    try { d.pragma('wal_checkpoint(TRUNCATE)') } catch {}
  }
  if (vacuum) {
    d.exec('VACUUM')
    vacuumRan = true
    if (walTruncate) {
      try { d.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    }
  }

  const after = getMaintenanceStats({ includeCounts: false })
  return { keepDays, cutoff, batchSize, deletedRows, vacuumRan, before, after }
}

module.exports = {
  init,
  listTargets,
  getTarget,
  insertTarget,
  updateTarget,
  deleteTarget,
  latestMetric,
  latestMetrics,
  insertMetric,
  rangeMetrics,
  cleanupBefore,
  getDbPath,
  getConfig,
  setConfig,
  getMaintenanceConfig,
  getMaintenanceStats,
  getDbDiagnostics,
  cleanupOldMetrics
}
