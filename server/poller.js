function createPollOnce({ store, connectorFor, logger, resolveKeepHours }) {
  const inFlight = new Set()
  return function pollOnce() {
    const now = Date.now()
    const dbs = store.listTargets()
    for (const cfg of dbs) {
      if (inFlight.has(cfg.id)) continue
      const configuredRole = String(cfg.repl_role || '').toLowerCase()
      const conn = connectorFor(cfg)
      inFlight.add(cfg.id)
      Promise.resolve()
        .then(() => conn.collectMetrics())
        .then((m) => {
          const resolvedRole = String((m && m.role) || configuredRole || '').toLowerCase() || 'unknown'
          const point = { ts: now, online: true, ...m, role: resolvedRole }
          if (point.role !== 'slave' && (point.slaveDelay === undefined || point.slaveDelay === null)) point.slaveDelay = -1
          store.insertMetric(cfg.id, point)
        })
        .catch((err) => {
          logger.error(`Collect metrics failed for ${cfg.name}: ${err && err.message ? err.message : String(err)}`)
          const point = { ts: now, online: false, sessions: 0, threadsRunning: 0, qps: 0, tps: 0, slowCount: 0, role: configuredRole || 'unknown', slaveDelay: -1 }
          store.insertMetric(cfg.id, point)
        })
        .finally(() => {
          inFlight.delete(cfg.id)
        })
    }
  }
}

module.exports = { createPollOnce }
