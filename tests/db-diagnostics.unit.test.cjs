const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('getDbDiagnostics should include sizes and explain when targetId provided', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-diag-'))
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
  store.insertMetric('t1', { ts: 1000, online: true, sessions: 1, threadsRunning: 1, qps: 1, tps: 1, role: 'master' })

  const diag = store.getDbDiagnostics({ targetId: 't1', fromTs: 0, toTs: 2000, maxPoints: 10 })
  assert.ok(diag.dbPath)
  assert.ok(diag.sizes.totalSizeBytes >= 0)
  assert.ok(diag.pragmas)
  assert.ok(diag.explain)
  assert.equal(diag.explain.targetId, 't1')
  assert.ok(Array.isArray(diag.explain.plans.latestMetric))

  if (prevDbPath === undefined) delete process.env.DB_PATH
  else process.env.DB_PATH = prevDbPath
  if (prevDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevDataDir
})

