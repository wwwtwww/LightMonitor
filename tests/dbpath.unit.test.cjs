const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveDbPaths } = require('../server/dbpath')

test('resolveDbPaths should fall back to ..\\LightMonitorData when default db is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-dbpath-'))
  const baseDir = path.join(tmp, 'project', 'server')
  fs.mkdirSync(baseDir, { recursive: true })

  const altDbPath = path.join(tmp, 'LightMonitorData', 'monitor.db')
  fs.mkdirSync(path.dirname(altDbPath), { recursive: true })
  fs.writeFileSync(altDbPath, 'x')

  const r = resolveDbPaths(baseDir, {}, fs.existsSync)
  assert.equal(path.normalize(r.dbPath), path.normalize(altDbPath))
})

test('resolveDbPaths should honor env DB_PATH', () => {
  const r = resolveDbPaths('C:\\app\\server', { DB_PATH: 'D:\\data\\monitor.db' }, () => false)
  assert.equal(r.dbPath, 'D:\\data\\monitor.db')
})

