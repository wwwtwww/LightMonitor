function roleOf(row) {
  const latest = row?.latest || {}
  const lr = String(latest.role || '').toLowerCase()
  if (lr && lr !== 'unknown') return lr
  return String(row?.repl_role || '').toLowerCase()
}

function masterIdOf(row) {
  const opt = row?.options || {}
  return opt.masterId || opt.master_id || opt.masterID || opt.master || null
}

function str(v) {
  return String(v == null ? '' : v)
}

function keyText(row) {
  return `${str(row.system_name)} ${str(row.business_system)} ${str(row.name)} ${str(row.host)}:${str(row.port)} ${str(row.remark)}`.toLowerCase()
}

export function filterTree(nodes, keyword) {
  const k = str(keyword).trim().toLowerCase()
  if (!k) return nodes
  const matches = (row) => keyText(row).includes(k)
  const walk = (list) => {
    const out = []
    for (const n of list || []) {
      const children = n.children && n.children.length ? walk(n.children) : []
      if (matches(n) || children.length) out.push({ ...n, children })
    }
    return out
  }
  return walk(nodes)
}

export function buildTargetTree(rows) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) map.set(r.id, { ...r, children: [] })

  const mastersByGroup = new Map()
  for (const r of map.values()) {
    const role = roleOf(r)
    if (role !== 'master') continue
    const gk = `${str(r.system_name)}|${str(r.type).toLowerCase()}`
    if (!mastersByGroup.has(gk)) mastersByGroup.set(gk, [])
    mastersByGroup.get(gk).push(r.id)
  }

  const attached = new Set()
  for (const r of map.values()) {
    const role = roleOf(r)
    if (role !== 'slave') continue
    const masterId = masterIdOf(r)
    if (masterId && map.has(masterId)) {
      map.get(masterId).children.push(r)
      attached.add(r.id)
      continue
    }
    const gk = `${str(r.system_name)}|${str(r.type).toLowerCase()}`
    const masters = mastersByGroup.get(gk) || []
    if (masters.length === 1) {
      map.get(masters[0]).children.push(r)
      attached.add(r.id)
    }
  }

  const roleWeight = (row) => {
    const r = roleOf(row)
    if (r === 'master') return 0
    if (r === 'standalone') return 1
    if (r === 'slave') return 2
    return 3
  }
  const byName = (a, b) => str(a.name).localeCompare(str(b.name))
  const sortNode = (n) => {
    if (n.children && n.children.length) {
      n.children.sort((a, b) => roleWeight(a) - roleWeight(b) || byName(a, b))
      for (const c of n.children) sortNode(c)
    }
  }

  const roots = []
  for (const r of map.values()) {
    if (!attached.has(r.id)) roots.push(r)
  }

  roots.sort((a, b) => {
    const sa = str(a.system_name).localeCompare(str(b.system_name))
    if (sa !== 0) return sa
    return roleWeight(a) - roleWeight(b) || byName(a, b)
  })
  for (const r of roots) sortNode(r)
  return roots
}
