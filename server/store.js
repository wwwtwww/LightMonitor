const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const defaultDataDir = path.join(__dirname, '..', 'data')
const dataDir = process.env.LIGHTMONITOR_DATA_DIR || process.env.DATA_DIR || defaultDataDir
const dbPath = process.env.LIGHTMONITOR_DB_PATH || process.env.DB_PATH || path.join(dataDir, 'monitor.db')

let db

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function openDb() {
  if (db) return db
  ensureDir()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      name TEXT,
      business_system TEXT,
      repl_role TEXT,
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
      created_at INTEGER,
      FOREIGN KEY(target_id) REFERENCES targets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_target_time ON metrics(target_id, created_at);
  `)
  
  // Migration for new columns
  try { db.exec(`ALTER TABLE targets ADD COLUMN business_system TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE targets ADD COLUMN repl_role TEXT`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN slave_delay INTEGER`) } catch (_) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN role TEXT`) } catch (_) {}

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
    threadsRunning: r.threads_running || 0,
    qps: r.qps || 0,
    tps: r.tps || 0,
    slaveDelay: r.slave_delay ?? -1,
    slowCount: r.slow_queries || 0
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
    INSERT INTO targets(id, name, business_system, repl_role, db_type, host, port, user, password, options, created_at, updated_at)
    VALUES(@id,@name,@business_system,@repl_role,@db_type,@host,@port,@user,@password,@options,@created_at,@updated_at)
  `).run({
    id: rec.id,
    name: rec.name || rec.host,
    business_system: rec.business_system || '',
    repl_role: rec.repl_role || '',
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
      name=@name, business_system=@business_system, repl_role=@repl_role, db_type=@db_type, host=@host, port=@port, user=@user, password=@password, options=@options, updated_at=@updated_at
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

function insertMetric(targetId, point, keepHours) {
  const d = openDb()
  const ts = point.ts || nowMs()
  d.prepare(`
    INSERT INTO metrics(target_id, status, role, connections, resp_time, qps, tps, slave_delay, slow_queries, threads_running, created_at)
    VALUES(@target_id,@status,@role,@connections,@resp_time,@qps,@tps,@slave_delay,@slow_queries,@threads_running,@created_at)
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
    created_at: ts
  })
  if (typeof keepHours === 'number') {
    const cutoff = Date.now() - keepHours * 3600 * 1000
    d.prepare(`DELETE FROM metrics WHERE created_at < ?`).run(cutoff)
  }
}

function rangeMetrics(targetId, fromTs, toTs) {
  const d = openDb()
  const rows = d.prepare(`
    SELECT * FROM metrics
    WHERE target_id = ? AND created_at BETWEEN ? AND ?
    ORDER BY created_at ASC
  `).all(targetId, fromTs, toTs)
  return rows.map(toApiMetric)
}

function cleanupBefore(ts) {
  const d = openDb()
  d.prepare(`DELETE FROM metrics WHERE created_at < ?`).run(ts)
}

module.exports = {
  init,
  listTargets,
  getTarget,
  insertTarget,
  updateTarget,
  deleteTarget,
  latestMetric,
  insertMetric,
  rangeMetrics,
  cleanupBefore
}
