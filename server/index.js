const http = require('http')
const url = require('url')
const path = require('path')
const fs = require('fs')
const logger = require('./logger')
const store = require('./store')
const MySQLConnector = require('./connectors/mysql')
const OracleConnector = require('./connectors/oracle')
const SQLServerConnector = require('./connectors/sqlserver')
const { createPollOnce } = require('./poller')

store.init()

function respondJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(obj))
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => {
      try {
        const obj = data ? JSON.parse(data) : {}
        resolve(obj)
      } catch (_) {
        resolve({})
      }
    })
  })
}

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'db_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function connectorFor(cfg) {
  const t = (cfg.type || '').toLowerCase()
  if (t === 'mysql') return new MySQLConnector(cfg)
  if (t === 'oracle') return new OracleConnector(cfg)
  if (t === 'mssql') return new SQLServerConnector(cfg)
  return new MySQLConnector(cfg)
}

async function latestMetricFromDb(id) {
  return store.latestMetric(id)
}

async function handleApi(req, res, parsed) {
  const { pathname, query } = parsed
  if (req.method === 'OPTIONS') return respondJson(res, 200, {})
  if (pathname === '/api/test-connection' && req.method === 'POST') {
    const body = await parseBody(req)
    const type = String(body.type || '').toLowerCase()
    const allowedTypes = new Set(['mysql', 'oracle', 'mssql'])
    if (!allowedTypes.has(type)) return respondJson(res, 400, { ok: false, online: false, error: 'invalid_type' })
    const host = String(body.host || '').trim()
    if (!host) return respondJson(res, 400, { ok: false, online: false, error: 'invalid_host' })
    const port = (body.port === undefined || body.port === null || body.port === '') ? null : Number(body.port)
    if (port !== null && Number.isNaN(port)) return respondJson(res, 400, { ok: false, online: false, error: 'invalid_port' })
    try {
      const cfg = {
        id: body.id || '',
        type,
        host,
        port,
        user: body.user || '',
        password: body.password || '',
        options: body.options || {},
      }
      const conn = connectorFor(cfg)
      const r = await conn.testConnection()
      return respondJson(res, 200, r)
    } catch (e) {
      return respondJson(res, 200, { ok: false, online: false, error: e && (e.code || 'connect_error'), detail: e && (e.message || '') })
    }
  }
  if (pathname === '/api/databases' && req.method === 'GET') {
    const dbs = store.listTargets()
    const latestById = store.latestMetrics(dbs.map(d => d.id))
    const list = dbs.map(d => {
      const { password, ...pub } = d
      return { ...pub, latest: latestById[d.id] || null }
    })
    return respondJson(res, 200, { data: list })
  }
  if (pathname === '/api/databases' && req.method === 'POST') {
    const body = await parseBody(req)
    const type = String(body.type || '').toLowerCase()
    const allowedTypes = new Set(['mysql', 'oracle', 'mssql'])
    if (!allowedTypes.has(type)) return respondJson(res, 400, { error: 'invalid_type' })
    const host = String(body.host || '').trim()
    if (!host) return respondJson(res, 400, { error: 'invalid_host' })
    const port = (body.port === undefined || body.port === null || body.port === '') ? null : Number(body.port)
    if (port !== null && Number.isNaN(port)) return respondJson(res, 400, { error: 'invalid_port' })
    const id = genId()
    const rec = {
      id,
      name: body.name || host,
      business_system: body.business_system || '',
      repl_role: body.repl_role || '',
      remark: body.remark || '',
      type,
      host,
      port,
      user: body.user || '',
      password: body.password || '',
      options: body.options || {},
    }
    if (type === 'mysql') {
      try {
        const conn = connectorFor(rec)
        const r = await conn.testConnection()
        if (!r || !r.ok || !r.online) return respondJson(res, 400, { error: 'connect_failed', detail: r?.error || 'connect_error' })
      } catch (e) {
        return respondJson(res, 400, { error: 'connect_failed', detail: e && (e.code || e.message || 'connect_error') })
      }
    }
    try {
      store.insertTarget(rec)
      logger.info(`Added target: ${rec.name} (${rec.host}:${rec.port || ''})`)
      return respondJson(res, 200, { data: rec })
    } catch (e) {
      logger.error(`Add target failed: ${e && (e.message || e)}`)
      return respondJson(res, 500, { error: 'add_target_failed' })
    }
  }
  if (pathname.startsWith('/api/databases/') && req.method === 'PUT') {
    const id = pathname.split('/').pop()
    const body = await parseBody(req)
    const exist = store.getTarget(id)
    if (!exist) return respondJson(res, 404, { error: 'not_found' })
    const update = { ...body }
    if ('password' in update && (!update.password || update.password === '')) {
      delete update.password
    }
    const updated = store.updateTarget(id, update)
    logger.info(`Updated target: ${id}`)
    const { password, ...pub } = updated || {}
    return respondJson(res, 200, { data: pub })
  }
  if (pathname.startsWith('/api/databases/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop()
    store.deleteTarget(id)
    logger.info(`Deleted target: ${id}`)
    return respondJson(res, 200, { ok: true })
  }
  if (pathname.endsWith('/test') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg) return respondJson(res, 404, { error: 'not_found' })
    const conn = connectorFor(cfg)
    const r = await conn.testConnection()
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/status') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const last = store.latestMetric(id)
    return respondJson(res, 200, { data: last })
  }
  if (pathname.endsWith('/metrics') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const now = Date.now()
    const stepMs = Number(query.stepMs)
    const maxPoints = Number(query.maxPoints)
    const metricOptions = {
      stepMs: Number.isFinite(stepMs) && stepMs > 0 ? Math.floor(stepMs) : undefined,
      maxPoints: Number.isFinite(maxPoints) && maxPoints > 0 ? Math.floor(maxPoints) : undefined
    }
    if (query.from !== undefined && query.to !== undefined) {
      const from = Number(query.from)
      const to = Number(query.to)
      if (!Number.isNaN(from) && !Number.isNaN(to) && to >= from) {
        const arr = store.rangeMetrics(id, from, to, metricOptions)
        return respondJson(res, 200, { data: arr })
      }
    }
    if (query.range) {
      const m = String(query.range).trim().match(/^(\d+)\s*h$/i)
      if (m) {
        const hours = Math.max(1, Number(m[1]))
        const from = now - hours * 3600 * 1000
        const arr = store.rangeMetrics(id, from, now, metricOptions)
        return respondJson(res, 200, { data: arr })
      }
    }
    if (query.date) {
      const dt = new Date(query.date)
      if (!Number.isNaN(dt.getTime())) {
        const from = dt.getTime()
        const to = from + 3600 * 1000
        const arr = store.rangeMetrics(id, from, to, metricOptions)
        return respondJson(res, 200, { data: arr })
      }
    }
    const arr = store.rangeMetrics(id, 0, now, metricOptions)
    return respondJson(res, 200, { data: arr })
  }
  if (pathname.endsWith('/mock') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg) return respondJson(res, 404, { error: 'not_found' })
    const body = await parseBody(req)
    const now = Date.now()
    let points = []
    if (parsed.query.range === '1h' || body.range === '1h' || (!parsed.query.date && !body.date)) {
      const step = 30000
      const from = now - 3600 * 1000
      const n = Math.floor((now - from) / step)
      for (let i = 0; i <= n; i++) {
        const ts = from + i * step
        const phase = i / n
        const sessions = Math.max(1, Math.round(20 + 10 * Math.sin(phase * Math.PI * 2)))
        const qps = Math.max(0, Math.round(80 + 40 * Math.sin(phase * Math.PI * 4) + Math.random() * 20))
        const tps = Math.max(0, Math.round(30 + 15 * Math.sin(phase * Math.PI * 3) + Math.random() * 10))
        const slowCount = Math.random() < 0.1 ? Math.floor(Math.random() * 3) : 0
        points.push({ ts, online: true, sessions, qps, tps, slowCount })
      }
    } else if (parsed.query.date || body.date) {
      const d = new Date((parsed.query.date || body.date) + 'T00:00:00Z')
      const from = d.getTime()
      const to = from + 24 * 3600 * 1000
      const step = 60000
      const n = Math.floor((to - from) / step)
      for (let i = 0; i <= n; i++) {
        const ts = from + i * step
        const phase = i / n
        const sessions = Math.max(1, Math.round(15 + 8 * Math.sin(phase * Math.PI * 6)))
        const qps = Math.max(0, Math.round(60 + 30 * Math.sin(phase * Math.PI * 10) + Math.random() * 15))
        const tps = Math.max(0, Math.round(25 + 12 * Math.sin(phase * Math.PI * 8) + Math.random() * 8))
        const slowCount = Math.random() < 0.05 ? 1 : 0
        points.push({ ts, online: true, sessions, qps, tps, slowCount })
      }
    }
    const keepHours = Number(process.env.RETAIN_HOURS || 24 * 7)
    for (const p of points) store.insertMetric(id, p, keepHours)
    return respondJson(res, 200, { inserted: points.length })
  }
  if (pathname.endsWith('/mysql/locks') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'mysql') return respondJson(res, 400, { error: 'mysql_only' })
    const conn = connectorFor(cfg)
    const r = await conn.getLocks()
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/mysql/kill') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'mysql') return respondJson(res, 400, { error: 'mysql_only' })
    const body = await parseBody(req)
    const conn = connectorFor(cfg)
    const r = await conn.killThread(body.threadId)
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/mysql/top-slow') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'mysql') return respondJson(res, 400, { error: 'mysql_only' })
    const conn = connectorFor(cfg)
    const r = await conn.topSlowQueries()
    return respondJson(res, 200, { data: r })
  }
  if (pathname.endsWith('/mssql/blocking') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'mssql') return respondJson(res, 400, { error: 'mssql_only' })
    const conn = connectorFor(cfg)
    const r = await conn.getBlocking()
    return respondJson(res, 200, { data: r })
  }
  if (pathname.endsWith('/oracle/locks') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'oracle') return respondJson(res, 400, { error: 'oracle_only' })
    const conn = connectorFor(cfg)
    const r = await conn.getLocks()
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/oracle/capacity') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = store.getTarget(id)
    if (!cfg || cfg.type.toLowerCase() !== 'oracle') return respondJson(res, 400, { error: 'oracle_only' })
    const conn = connectorFor(cfg)
    const r = await conn.getCapacity()
    return respondJson(res, 200, { data: r })
  }
  if (pathname === '/api/maintenance/stats' && req.method === 'GET') {
    const includeCounts = String(query.includeCounts || '') === '1'
    const s = store.getMaintenanceStats({ includeCounts })
    return respondJson(res, 200, {
      data: {
        db_size_mb: Number((s.dbSizeBytes / (1024 * 1024)).toFixed(2)),
        db_total_size_mb: Number((s.totalSizeBytes / (1024 * 1024)).toFixed(2)),
        monitor_logs: s.metricsRows === null ? null : s.metricsRows,
        monitor_targets: s.targetsRows,
        metrics_rows: s.metricsRows === null ? null : s.metricsRows,
        targets_rows: s.targetsRows
      }
    })
  }
  if (pathname === '/api/maintenance/config' && req.method === 'GET') {
    const cfg = store.getMaintenanceConfig()
    return respondJson(res, 200, { data: cfg })
  }
  if (pathname === '/api/maintenance/config' && req.method === 'POST') {
    const body = await parseBody(req)
    const days = Number(body.retention_days)
    const time = String(body.cleanup_time || '').trim()
    const retention_days = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7
    const cleanup_time = /^\d{2}:\d{2}$/.test(time) ? time : '03:00'
    store.setConfig('retention_days', String(retention_days))
    store.setConfig('cleanup_time', cleanup_time)
    return respondJson(res, 200, { ok: true, data: { retention_days, cleanup_time } })
  }
  if (pathname === '/api/maintenance/cleanup' && req.method === 'POST') {
    const body = await parseBody(req)
    const days = Number(body.days)
    const vacuum = body.vacuum === true
    const batchSize = Number(body.batchSize)
    const r = await store.cleanupOldMetrics({
      days: Number.isFinite(days) && days > 0 ? Math.floor(days) : store.getMaintenanceConfig().retention_days,
      vacuum,
      walTruncate: true,
      batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : undefined
    })
    return respondJson(res, 200, {
      ok: true,
      data: {
        deleted_rows: r.deletedRows,
        keep_days: r.keepDays,
        vacuum_ran: r.vacuumRan,
        db_size_mb_before: Number((r.before.dbSizeBytes / (1024 * 1024)).toFixed(2)),
        db_size_mb_after: Number((r.after.dbSizeBytes / (1024 * 1024)).toFixed(2)),
        db_total_size_mb_before: Number((r.before.totalSizeBytes / (1024 * 1024)).toFixed(2)),
        db_total_size_mb_after: Number((r.after.totalSizeBytes / (1024 * 1024)).toFixed(2))
      }
    })
  }
  if (pathname === '/api/diagnostics/db' && req.method === 'GET') {
    const includeCounts = String(query.includeCounts || '') === '1'
    const targetId = String(query.targetId || '').trim()
    const now = Date.now()
    const maxPoints = Number(query.maxPoints)
    const stepMs = Number(query.stepMs)
    let fromTs = NaN
    let toTs = NaN
    if (query.from !== undefined && query.to !== undefined) {
      fromTs = Number(query.from)
      toTs = Number(query.to)
    } else if (query.range) {
      const m = String(query.range).trim().match(/^(\d+)\s*h$/i)
      if (m) {
        const hours = Math.max(1, Number(m[1]))
        fromTs = now - hours * 3600 * 1000
        toTs = now
      }
    }
    const diag = store.getDbDiagnostics({
      includeCounts,
      targetId,
      fromTs,
      toTs,
      maxPoints: Number.isFinite(maxPoints) && maxPoints > 0 ? Math.floor(maxPoints) : undefined,
      stepMs: Number.isFinite(stepMs) && stepMs > 0 ? Math.floor(stepMs) : undefined
    })
    return respondJson(res, 200, { data: diag })
  }
  return false
}

function serveStatic(req, res, parsed) {
  const base = path.join(__dirname, '..', 'public')
  let p = parsed.pathname
  if (p === '/') p = '/index.html'
  const target = path.normalize(path.join(base, p))
  if (!target.startsWith(base)) return false
  let fileToServe = target
  if (!fs.existsSync(fileToServe)) {
    if (p.startsWith('/vendor/')) {
      const bn = path.basename(p)
      const nmBase = path.join(__dirname, '..', 'node_modules')
      const fallbackMap = {
        'chart.umd.min.js': path.join(nmBase, 'chart.js', 'dist', 'chart.umd.min.js'),
        'chartjs-adapter-date-fns.bundle.min.js': path.join(nmBase, 'chartjs-adapter-date-fns', 'dist', 'chartjs-adapter-date-fns.bundle.min.js'),
      }
      const fb = fallbackMap[bn]
      if (fb && fs.existsSync(fb)) {
        fileToServe = fb
      } else {
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        })
        res.end('Not Found')
        return true
      }
    } else {
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      })
      res.end('Not Found')
      return true
    }
  }
  const stat = fs.statSync(fileToServe)
  if (stat.isDirectory()) return false
  const ext = path.extname(fileToServe)
  const map = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }
  res.writeHead(200, {
    'Content-Type': map[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  })
  fs.createReadStream(fileToServe).pipe(res)
  return true
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true)
  if (parsed.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, parsed)
    if (handled !== false) return
    logger.warn(`API not found: ${req.method} ${parsed.pathname}`)
    return respondJson(res, 404, { error: 'not_found' })
  }
  if (serveStatic(req, res, parsed)) return
  res.writeHead(302, { Location: '/' })
  res.end()
})

const pollOnce = createPollOnce({
  store,
  connectorFor,
  logger,
  resolveKeepHours: (maintenanceCfg) => Number(process.env.RETAIN_HOURS || maintenanceCfg.retention_days * 24)
})

const SAMPLE_MS = Number(process.env.SAMPLE_MS || 5000)
pollOnce()
setInterval(pollOnce, SAMPLE_MS)

let maintenanceInFlight = false
setInterval(async () => {
  if (maintenanceInFlight) return
  const cfg = store.getMaintenanceConfig()
  const time = String(cfg.cleanup_time || '03:00')
  const m = time.match(/^(\d{2}):(\d{2})$/)
  if (!m) return
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (now.getHours() !== hh || now.getMinutes() !== mm) return
  const lastTs = Number(store.getConfig('last_cleanup_at') || 0)
  if (Number.isFinite(lastTs) && lastTs > 0) {
    const last = new Date(lastTs)
    const lastDay = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
    if (lastDay === today) return
  }
  maintenanceInFlight = true
  try {
    const r = await store.cleanupOldMetrics({ days: cfg.retention_days, vacuum: false, walTruncate: true })
    store.setConfig('last_cleanup_at', String(Date.now()))
    logger.info(`Maintenance cleanup done: keep_days=${r.keepDays} deleted_rows=${r.deletedRows}`)
  } catch (e) {
    logger.error(`Maintenance cleanup failed: ${e && (e.message || e)}`)
  } finally {
    maintenanceInFlight = false
  }
}, 30 * 1000)

const PORT = process.env.PORT || 8080
const HOST = process.env.HOST || process.env.BIND_HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
  logger.info(`LightMonitor server started on ${HOST}:${PORT}`)
})
