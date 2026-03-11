const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('rangeMetrics should downsample to maxPoints', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-range-'))
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'monitor.db')

  const prevDbPath = process.env.DB_PATH
  const prevDataDir = process.env.DATA_DIR
  process.env.DB_PATH = dbPath
  process.env.DATA_DIR = dataDir

  const store = require('../server/store')
  store.init()

  store.insertTarget({ id: 't1', name: 't1', business_system: '', repl_role: '', remark: '', type: 'mssql', host: 'h', port: 1, user: 'u', password: 'p', options: {} })

  const start = 1_000_000
  for (let i = 0; i < 100; i++) {
    store.insertMetric('t1', { ts: start + i * 1000, online: true, sessions: i, qps: i, tps: i, threadsRunning: i, role: 'master', extra_data: '{}' })
  }

  const from = start
  const to = start + 99 * 1000
  const rows = store.rangeMetrics('t1', from, to, { maxPoints: 10 })
  assert.ok(rows.length > 0)
  assert.ok(rows.length <= 12)
  for (const r of rows) assert.ok(r && typeof r.ts === 'number')

  if (prevDbPath === undefined) delete process.env.DB_PATH
  else process.env.DB_PATH = prevDbPath
  if (prevDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = prevDataDir
})
