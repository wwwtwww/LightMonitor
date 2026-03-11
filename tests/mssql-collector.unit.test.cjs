const test = require('node:test')
const assert = require('node:assert/strict')

const { createPollOnce } = require('../server/poller')
const SQLServerConnector = require('../server/connectors/sqlserver')
const { shouldRefresh } = require('../server/utils/shouldRefresh')

const flush = () => new Promise((r) => setImmediate(r))

test('pollOnce should not overlap collectMetrics for same target', async () => {
  let collectCalls = 0
  let resolveCollect
  const collectPromise = new Promise((r) => { resolveCollect = r })

  const store = {
    getMaintenanceConfig: () => ({ retention_days: 7 }),
    listTargets: () => [{ id: 't1', name: 'db1', type: 'mssql', repl_role: '' }],
    insertMetric: () => {},
    cleanupBefore: () => {}
  }
  const connectorFor = () => ({
    collectMetrics: () => {
      collectCalls += 1
      return collectPromise
    }
  })
  const logger = { error: () => {} }

  const pollOnce = createPollOnce({
    store,
    connectorFor,
    logger,
    resolveKeepHours: () => 1
  })

  pollOnce()
  pollOnce()
  await flush()
  assert.equal(collectCalls, 1)

  resolveCollect({ sessions: 1, qps: 1 })
  await flush()

  pollOnce()
  await flush()
  assert.equal(collectCalls, 2)
})

test('pollOnce should release inFlight after failed collectMetrics', async () => {
  let collectCalls = 0
  let rejectCollect
  const collectPromise = new Promise((_, rj) => { rejectCollect = rj })

  const store = {
    getMaintenanceConfig: () => ({ retention_days: 7 }),
    listTargets: () => [{ id: 't1', name: 'db1', type: 'mssql', repl_role: '' }],
    insertMetric: () => {},
    cleanupBefore: () => {}
  }
  const connectorFor = () => ({
    collectMetrics: () => {
      collectCalls += 1
      return collectPromise
    }
  })
  const logger = { error: () => {} }

  const pollOnce = createPollOnce({
    store,
    connectorFor,
    logger,
    resolveKeepHours: () => 1
  })

  pollOnce()
  pollOnce()
  await flush()
  assert.equal(collectCalls, 1)

  rejectCollect(new Error('timeout'))
  await flush()

  pollOnce()
  await flush()
  assert.equal(collectCalls, 2)
})

test('sqlserver toSqlConfig should default to 15000ms timeouts', () => {
  const { toSqlConfig } = SQLServerConnector._internal
  const cfg = { host: '127.0.0.1', port: 1433, user: 'u', password: 'p', options: {} }
  const c = toSqlConfig(cfg)
  assert.equal(c.connectionTimeout, 15000)
  assert.equal(c.requestTimeout, 15000)
})

test('sqlserver toSqlConfig should honor per-target timeouts', () => {
  const { toSqlConfig } = SQLServerConnector._internal
  const cfg = { host: '127.0.0.1', port: 1433, user: 'u', password: 'p', options: { connectTimeoutMs: 22000, requestTimeoutMs: 33000 } }
  const c = toSqlConfig(cfg)
  assert.equal(c.connectionTimeout, 22000)
  assert.equal(c.requestTimeout, 33000)
})

test('pollOnce should run multiple targets in parallel but serialize per target', async () => {
  const calls = { t1: 0, t2: 0 }
  let resolve1
  let resolve2
  const p1 = new Promise((r) => { resolve1 = r })
  const p2 = new Promise((r) => { resolve2 = r })

  const store = {
    getMaintenanceConfig: () => ({ retention_days: 7 }),
    listTargets: () => [
      { id: 't1', name: 'db1', type: 'mssql', repl_role: '' },
      { id: 't2', name: 'db2', type: 'mssql', repl_role: '' }
    ],
    insertMetric: () => {},
    cleanupBefore: () => {}
  }
  const connectorFor = (cfg) => ({
    collectMetrics: () => {
      calls[cfg.id] += 1
      return cfg.id === 't1' ? p1 : p2
    }
  })
  const logger = { error: () => {} }

  const pollOnce = createPollOnce({
    store,
    connectorFor,
    logger,
    resolveKeepHours: () => 1
  })

  pollOnce()
  await flush()
  assert.deepEqual(calls, { t1: 1, t2: 1 })

  pollOnce()
  await flush()
  assert.deepEqual(calls, { t1: 1, t2: 1 })

  resolve1({ sessions: 1, qps: 1 })
  await flush()

  pollOnce()
  await flush()
  assert.deepEqual(calls, { t1: 2, t2: 1 })

  resolve2({ sessions: 1, qps: 1 })
  await flush()
})

test('shouldRefresh should gate expensive work by interval', () => {
  assert.equal(shouldRefresh(1000, 0, 10000), true)
  assert.equal(shouldRefresh(1000, 500, 10000), false)
  assert.equal(shouldRefresh(10500, 500, 10000), true)
  assert.equal(shouldRefresh(10500, 5500, 10000), false)
  assert.equal(shouldRefresh(15500, 5500, 10000), true)
})
