const store = require('../server/store')

function hasFlag(name) {
  return process.argv.includes(name)
}

function pick(arr, i) {
  return arr[i % arr.length]
}

function clampInt(n, min, max) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

function mkHost(i) {
  const a = 10
  const b = 10 + Math.floor(i / 250)
  const c = Math.floor(i / 25) % 10
  const d = (i % 250) + 2
  return `${a}.${b}.${c}.${d}`
}

function mkTarget(i, type) {
  const systems = ['System Name 1', 'System Name 2', 'System Name 3', 'System Name 4', 'System Name 5', 'System Name 6', 'System Name 7', 'System Name 8']
  const role = 'standalone'
  const host = mkHost(i)
  const port = type === 'mysql' ? 3306 : type === 'oracle' ? 1521 : 1433
  const namePrefix = type === 'mysql' ? 'database' : type === 'oracle' ? 'oracle' : 'mssql'
  const name = `${namePrefix}${i + 1}`
  const systemName = pick(systems, i)
  const user = type === 'mysql' ? 'root' : type === 'oracle' ? 'system' : 'sa'
  return {
    id: `seed_${type}_${String(i + 1).padStart(3, '0')}`,
    name,
    business_system: systemName,
    repl_role: role,
    remark: 'seed',
    type,
    host,
    port,
    user,
    password: '',
    options: type === 'oracle' ? { serviceName: 'ORCL' } : {}
  }
}

function mkMetric(target, i) {
  const online = i % 7 !== 0
  const sessions = clampInt((i * 13) % 240, 0, 240)
  const threadsRunning = clampInt((i * 5) % 32, 0, 64)
  const qps = Number(((i * 17) % 2400) / 10).toFixed(2)
  const tps = Number(((i * 11) % 900) / 10).toFixed(2)
  const slowCount = clampInt((i * 3) % 12, 0, 99)
  const role = (target.repl_role || '').toLowerCase()
  const slaveDelay = role === 'slave' ? clampInt((i * 19) % 120, 0, 3600) : -1

  let extraData = {}
  if (target.type === 'oracle') {
    extraData = { activeSessions: clampInt((i * 7) % 60, 0, 500) }
  } else if (target.type === 'mssql') {
    extraData = {
      ple: clampInt((i * 29) % 10000, 0, 999999),
      compilationsPerSec: Number(((i * 23) % 9000) / 100).toFixed(2)
    }
  }

  return {
    ts: Date.now() - (i % 30) * 60_000,
    online,
    role,
    sessions,
    threadsRunning,
    qps: Number(qps),
    tps: Number(tps),
    slaveDelay,
    slowCount,
    extra_data: Object.keys(extraData).length ? JSON.stringify(extraData) : ''
  }
}

function main() {
  store.init()

  const clear = hasFlag('--clear')
  const force = hasFlag('--force')
  const countFlag = process.argv.find(a => a.startsWith('--count='))
  const count = countFlag ? clampInt(countFlag.slice('--count='.length), 1, 5000) : 50

  const existing = store.listTargets()
  if (existing.length && !force && !clear) {
    console.log(`已有 ${existing.length} 条目标数据，未写入。需要覆盖请使用 --clear 或 --force`)
    console.log(`dbPath=${store.getDbPath()}`)
    process.exit(0)
  }

  if (clear && existing.length) {
    for (const t of existing) store.deleteTarget(t.id)
  }

  const systems = ['System Name 1', 'System Name 2', 'System Name 3', 'System Name 4', 'System Name 5', 'System Name 6', 'System Name 7', 'System Name 8']

  const targets = []

  const sys1 = systems[0]
  const db1 = { id: 'seed_mysql_db1', name: 'database1', business_system: sys1, repl_role: 'master', remark: 'seed', type: 'mysql', host: mkHost(1), port: 3306, user: 'root', password: '', options: {} }
  const db11 = { id: 'seed_mysql_db11', name: 'database11', business_system: sys1, repl_role: 'slave', remark: 'seed', type: 'mysql', host: mkHost(11), port: 3306, user: 'root', password: '', options: { masterId: db1.id } }
  const db2 = { id: 'seed_mysql_db2', name: 'database2', business_system: sys1, repl_role: 'master', remark: 'seed', type: 'mysql', host: mkHost(2), port: 3306, user: 'root', password: '', options: {} }
  const db21 = { id: 'seed_mysql_db21', name: 'database21', business_system: sys1, repl_role: 'slave', remark: 'seed', type: 'mysql', host: mkHost(21), port: 3306, user: 'root', password: '', options: { masterId: db2.id } }
  const db22 = { id: 'seed_mysql_db22', name: 'database22', business_system: sys1, repl_role: 'slave', remark: 'seed', type: 'mysql', host: mkHost(22), port: 3306, user: 'root', password: '', options: { masterId: db2.id } }
  const db3 = { id: 'seed_mysql_db3', name: 'database3', business_system: sys1, repl_role: 'standalone', remark: 'seed', type: 'mysql', host: mkHost(3), port: 3306, user: 'root', password: '', options: {} }
  targets.push(db1, db11, db2, db21, db22, db3)

  const sys2 = systems[1]
  const o1 = { id: 'seed_oracle_db1', name: 'oracle1', business_system: sys2, repl_role: 'master', remark: 'seed', type: 'oracle', host: mkHost(31), port: 1521, user: 'system', password: '', options: { serviceName: 'ORCL' } }
  const o11 = { id: 'seed_oracle_db11', name: 'oracle11', business_system: sys2, repl_role: 'slave', remark: 'seed', type: 'oracle', host: mkHost(41), port: 1521, user: 'system', password: '', options: { serviceName: 'ORCL', masterId: o1.id } }
  targets.push(o1, o11)

  const sys3 = systems[2]
  const s1 = { id: 'seed_mssql_db1', name: 'mssql1', business_system: sys3, repl_role: 'master', remark: 'seed', type: 'mssql', host: mkHost(51), port: 1433, user: 'sa', password: '', options: {} }
  const s11 = { id: 'seed_mssql_db11', name: 'mssql11', business_system: sys3, repl_role: 'slave', remark: 'seed', type: 'mssql', host: mkHost(61), port: 1433, user: 'sa', password: '', options: { masterId: s1.id } }
  targets.push(s1, s11)

  let idx = 4
  while (targets.length < count) {
    const i = idx
    const sys = systems[i % systems.length]
    const roll = i % 9
    const type = roll === 0 ? 'oracle' : roll === 1 ? 'mssql' : 'mysql'

    if (type === 'mysql') {
      const master = { id: `seed_mysql_m${i}`, name: `database${i}`, business_system: sys, repl_role: 'master', remark: 'seed', type: 'mysql', host: mkHost(100 + i), port: 3306, user: 'root', password: '', options: {} }
      targets.push(master)
      const want = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0
      for (let s = 0; s < want && targets.length < count; s++) {
        targets.push({
          id: `seed_mysql_m${i}_s${s + 1}`,
          name: `database${i}${s + 1}`,
          business_system: sys,
          repl_role: 'slave',
          remark: 'seed',
          type: 'mysql',
          host: mkHost(200 + i * 3 + s),
          port: 3306,
          user: 'root',
          password: '',
          options: { masterId: master.id }
        })
      }
    } else if (type === 'oracle') {
      const master = { id: `seed_oracle_m${i}`, name: `oracle${i}`, business_system: sys, repl_role: 'master', remark: 'seed', type: 'oracle', host: mkHost(300 + i), port: 1521, user: 'system', password: '', options: { serviceName: 'ORCL' } }
      targets.push(master)
      const want = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0
      for (let s = 0; s < want && targets.length < count; s++) {
        targets.push({
          id: `seed_oracle_m${i}_s${s + 1}`,
          name: `oracle${i}${s + 1}`,
          business_system: sys,
          repl_role: 'slave',
          remark: 'seed',
          type: 'oracle',
          host: mkHost(400 + i * 3 + s),
          port: 1521,
          user: 'system',
          password: '',
          options: { serviceName: 'ORCL', masterId: master.id }
        })
      }
    } else {
      const master = { id: `seed_mssql_m${i}`, name: `mssql${i}`, business_system: sys, repl_role: 'master', remark: 'seed', type: 'mssql', host: mkHost(500 + i), port: 1433, user: 'sa', password: '', options: {} }
      targets.push(master)
      const want = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0
      for (let s = 0; s < want && targets.length < count; s++) {
        targets.push({
          id: `seed_mssql_m${i}_s${s + 1}`,
          name: `mssql${i}${s + 1}`,
          business_system: sys,
          repl_role: 'slave',
          remark: 'seed',
          type: 'mssql',
          host: mkHost(600 + i * 3 + s),
          port: 1433,
          user: 'sa',
          password: '',
          options: { masterId: master.id }
        })
      }
    }
    idx += 1
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    store.insertTarget(t)
    store.insertMetric(t.id, mkMetric(t, i), 24 * 7)
  }

  const after = store.listTargets()
  console.log(`已写入 ${count} 条测试目标数据`)
  console.log(`当前目标总数=${after.length}`)
  console.log(`dbPath=${store.getDbPath()}`)
}

main()
