const http = require('http')
const url = require('url')
const path = require('path')
const fs = require('fs')
const logger = require('./logger')
const store = require('./store')
const MySQLConnector = require('./connectors/mysql')
const OracleConnector = require('./connectors/oracle')
const SQLServerConnector = require('./connectors/sqlserver')

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
  if (t === 'sqlserver') return new SQLServerConnector(cfg)
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
    const allowedTypes = new Set(['mysql', 'oracle', 'sqlserver'])
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
    const list = dbs.map(d => {
      const { password, ...pub } = d
      return { ...pub, latest: store.latestMetric(d.id) }
    })
    return respondJson(res, 200, { data: list })
  }
  if (pathname === '/api/databases' && req.method === 'POST') {
    const body = await parseBody(req)
    const type = String(body.type || '').toLowerCase()
    const allowedTypes = new Set(['mysql', 'oracle', 'sqlserver'])
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
    if (query.from && query.to) {
      const from = Number(query.from)
      const to = Number(query.to)
      if (!Number.isNaN(from) && !Number.isNaN(to) && to >= from) {
        const arr = store.rangeMetrics(id, from, to)
        return respondJson(res, 200, { data: arr })
      }
    }
    if (query.range) {
      const m = String(query.range).trim().match(/^(\d+)\s*h$/i)
      if (m) {
        const hours = Math.max(1, Number(m[1]))
        const from = now - hours * 3600 * 1000
        const arr = store.rangeMetrics(id, from, now)
        return respondJson(res, 200, { data: arr })
      }
    }
    if (query.date) {
      const dt = new Date(query.date)
      if (!Number.isNaN(dt.getTime())) {
        const from = dt.getTime()
        const to = from + 3600 * 1000
        const arr = store.rangeMetrics(id, from, to)
        return respondJson(res, 200, { data: arr })
      }
    }
    const arr = store.rangeMetrics(id, 0, now)
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

function pollOnce() {
  const keepHours = Number(process.env.RETAIN_HOURS || 24 * 7)
  const now = Date.now()
  const dbs = store.listTargets()
  for (const cfg of dbs) {
    const conn = connectorFor(cfg)
    conn.collectMetrics().then(m => {
      const point = { ts: now, online: true, ...m }
      store.insertMetric(cfg.id, point, keepHours)
    }).catch(err => {
      logger.error(`Collect metrics failed for ${cfg.name}: ${err.message}`)
      const point = { ts: now, online: false, sessions: 0, threadsRunning: 0, qps: 0, tps: 0, slowCount: 0, role: 'unknown', slaveDelay: -1 }
      store.insertMetric(cfg.id, point, keepHours)
    })
  }
  const cutoff = Date.now() - keepHours * 3600 * 1000
  store.cleanupBefore(cutoff)
}

const SAMPLE_MS = Number(process.env.SAMPLE_MS || 5000)
pollOnce()
setInterval(pollOnce, SAMPLE_MS)

const PORT = process.env.PORT || 8080
const HOST = process.env.HOST || process.env.BIND_HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
  logger.info(`LightMonitor server started on ${HOST}:${PORT}`)
})
