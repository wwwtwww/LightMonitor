const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('latestMetrics should return latest metric per target', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-store-'))
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'monitor.db')

  const prevDbPath = process.env.DB_PATH
  const prevDataDir = process.env.DATA_DIR
  process.env.DB_PATH = dbPath
  process.env.DATA_DIR = dataDir

  const store = require('../server/store')
  store.init()

  store.insertTarget({ id: 't1', name: 't1', business_system: '', repl_role: '', remark: '', type: 'mysql', host: 'h', port: 1, user: 'u', password: 'p', options: {} })
  store.insertTarget({ id: 't2', name: 't2', business_system: '', repl_role: '', remark: '', type: 'mysql', host: 'h', port: 1, user: 'u', password: 'p', options: {} })

  store.insertMetric('t1', { ts: 1000, online: true, sessions: 1, threadsRunning: 1, qps: 1, tps: 1, role: 'master' })
  store.insertMetric('t1', { ts: 2000, online: true, sessions: 2, threadsRunning: 2, qps: 2, tps: 2, role: 'master' })
  store.insertMetric('t2', { ts: 1500, online: true, sessions: 3, threadsRunning: 3, qps: 3, tps: 3, role: 'master' })

  const m = store.latestMetrics(['t1', 't2', 'missing'])
  assert.equal(m.t1.ts, 2000)
  assert.equal(m.t2.ts, 1500)

  if (prevDbPath === undefined) delete process.env.DB_PATH
  else process.env.DB_PATH = prevDbPath
  if (prevDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevDataDir
})

