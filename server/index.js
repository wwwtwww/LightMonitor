const http = require('http')
const url = require('url')
const path = require('path')
const fs = require('fs')
const store = require('./store')
const MySQLConnector = require('./connectors/mysql')
const OracleConnector = require('./connectors/oracle')
const SQLServerConnector = require('./connectors/sqlserver')

const state = store.init()

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

function latestMetric(id) {
  const arr = state.metrics[id] || []
  return arr.length ? arr[arr.length - 1] : null
}

async function handleApi(req, res, parsed) {
  const { pathname, query } = parsed
  if (req.method === 'OPTIONS') return respondJson(res, 200, {})
  if (pathname === '/api/databases' && req.method === 'GET') {
    const list = state.dbs.map(d => {
      const { password, ...pub } = d
      return { ...pub, latest: latestMetric(d.id) }
    })
    return respondJson(res, 200, { data: list })
  }
  if (pathname === '/api/databases' && req.method === 'POST') {
    const body = await parseBody(req)
    const id = genId()
    const rec = {
      id,
      name: body.name || body.host,
      type: body.type,
      host: body.host,
      port: body.port,
      user: body.user || '',
      password: body.password || '',
      options: body.options || {},
    }
    store.upsertDb(state.dbs, rec)
    store.saveAll(state.dbs, state.metrics)
    return respondJson(res, 200, { data: rec })
  }
  if (pathname.startsWith('/api/databases/') && req.method === 'PUT') {
    const id = pathname.split('/').pop()
    const body = await parseBody(req)
    const exist = state.dbs.find(x => x.id === id)
    if (!exist) return respondJson(res, 404, { error: 'not_found' })
    const update = { ...body }
    if ('password' in update && (!update.password || update.password === '')) {
      delete update.password
    }
    const rec = { ...exist, ...update, id }
    store.upsertDb(state.dbs, rec)
    store.saveAll(state.dbs, state.metrics)
    const { password, ...pub } = rec
    return respondJson(res, 200, { data: pub })
  }
  if (pathname.startsWith('/api/databases/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop()
    store.removeDb(state.dbs, id)
    delete state.metrics[id]
    store.saveAll(state.dbs, state.metrics)
    return respondJson(res, 200, { ok: true })
  }
  if (pathname.endsWith('/test') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = state.dbs.find(x => x.id === id)
    if (!cfg) return respondJson(res, 404, { error: 'not_found' })
    const conn = connectorFor(cfg)
    const r = await conn.testConnection()
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/status') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const last = latestMetric(id)
    return respondJson(res, 200, { data: last })
  }
  if (pathname.endsWith('/metrics') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const now = Date.now()
    if (query.range === '1h') {
      const from = now - 3600 * 1000
      const arr = require('./store').rangeMetrics(state.metrics, id, from, now)
      return respondJson(res, 200, { data: arr })
    }
    if (query.date) {
      const d = new Date(query.date + 'T00:00:00Z')
      const from = d.getTime()
      const to = from + 24 * 3600 * 1000 - 1
      const arr = require('./store').rangeMetrics(state.metrics, id, from, to)
      return respondJson(res, 200, { data: arr })
    }
    const arr = state.metrics[id] || []
    return respondJson(res, 200, { data: arr })
  }
  if (pathname.endsWith('/mock') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = state.dbs.find(x => x.id === id)
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
    if (!state.metrics[id]) state.metrics[id] = []
    const keepHours = Number(process.env.RETAIN_HOURS || 24 * 7)
    for (const p of points) store.pushMetric(state.metrics, id, p, keepHours)
    store.saveAll(state.dbs, state.metrics)
    return respondJson(res, 200, { inserted: points.length })
  }
  if (pathname.endsWith('/mysql/locks') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = state.dbs.find(x => x.id === id)
    if (!cfg || cfg.type.toLowerCase() !== 'mysql') return respondJson(res, 400, { error: 'mysql_only' })
    const conn = connectorFor(cfg)
    const r = await conn.getLocks()
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/mysql/kill') && req.method === 'POST') {
    const id = pathname.split('/')[3]
    const cfg = state.dbs.find(x => x.id === id)
    if (!cfg || cfg.type.toLowerCase() !== 'mysql') return respondJson(res, 400, { error: 'mysql_only' })
    const body = await parseBody(req)
    const conn = connectorFor(cfg)
    const r = await conn.killThread(body.threadId)
    return respondJson(res, 200, r)
  }
  if (pathname.endsWith('/mysql/top-slow') && req.method === 'GET') {
    const id = pathname.split('/')[3]
    const cfg = state.dbs.find(x => x.id === id)
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
    return respondJson(res, 404, { error: 'not_found' })
  }
  if (serveStatic(req, res, parsed)) return
  res.writeHead(302, { Location: '/' })
  res.end()
})

function pollOnce() {
  const keepHours = Number(process.env.RETAIN_HOURS || 24 * 7)
  const now = Date.now()
  for (const cfg of state.dbs) {
    const conn = connectorFor(cfg)
    conn.collectMetrics().then(m => {
      const point = { ts: now, online: true, ...m }
      store.pushMetric(state.metrics, cfg.id, point, keepHours)
      store.saveAll(state.dbs, state.metrics)
    }).catch(() => {
      const point = { ts: now, online: false, sessions: 0, qps: 0, tps: 0, slowCount: 0 }
      store.pushMetric(state.metrics, cfg.id, point, keepHours)
      store.saveAll(state.dbs, state.metrics)
    })
  }
}

const SAMPLE_MS = Number(process.env.SAMPLE_MS || 5000)
setInterval(pollOnce, SAMPLE_MS)

const PORT = process.env.PORT || 8080
server.listen(PORT, () => {
  console.log('LightMonitor server on', PORT)
})
