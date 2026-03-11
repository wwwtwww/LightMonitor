const path = require('path')

function resolveDbPaths(baseDir, env, existsSync) {
  const defaultDataDir = path.join(baseDir, '..', 'data')
  const altDataDir = path.join(baseDir, '..', '..', 'LightMonitorData')

  const dataDir = env.LIGHTMONITOR_DATA_DIR || env.DATA_DIR || defaultDataDir
  const dbPath = env.LIGHTMONITOR_DB_PATH || env.DB_PATH || path.join(dataDir, 'monitor.db')
  if (env.LIGHTMONITOR_DB_PATH || env.DB_PATH || env.LIGHTMONITOR_DATA_DIR || env.DATA_DIR) return { dataDir, dbPath }

  const defaultDbPath = path.join(defaultDataDir, 'monitor.db')
  const altDbPath = path.join(altDataDir, 'monitor.db')
  if (!existsSync(defaultDbPath) && existsSync(altDbPath)) return { dataDir: altDataDir, dbPath: altDbPath }
  return { dataDir: defaultDataDir, dbPath: defaultDbPath }
}

module.exports = { resolveDbPaths }
