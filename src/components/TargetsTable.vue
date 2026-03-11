<template>
  <el-card class="lm-table-card" shadow="never" :body-style="{ padding: '0' }">
    <div v-if="$slots.toolbar" class="lm-table-toolbar">
      <slot name="toolbar" />
    </div>
    <el-table
      :data="rows"
      :span-method="mergeBusinessSystem ? spanMethod : undefined"
      :header-cell-style="{ background: '#f8fafc', color: '#606266', fontWeight: 'bold' }"
      :border="false"
      empty-text="No data"
      row-key="id"
      default-expand-all
      :tree-props="{ children: 'children' }"
    >
      <el-table-column prop="name" label="Database Alias" min-width="180" align="left" header-align="left" show-overflow-tooltip>
        <template #default="scope">
          <span class="db-name">{{ scope.row.name }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Status" width="120" align="left" header-align="left" show-overflow-tooltip>
        <template #default="scope">
          <span class="status-cell">
            <span class="dot" :class="getLatest(scope.row).online ? 'dot-ok' : 'dot-bad'"></span>
            <span class="status-text">{{ getLatest(scope.row).online ? 'Online' : 'Offline' }}</span>
          </span>
        </template>
      </el-table-column>

      <el-table-column prop="system_name" label="System Name" min-width="180" show-overflow-tooltip align="left" header-align="left" />

      <el-table-column label="IP Address" min-width="180" align="left" header-align="left" show-overflow-tooltip>
        <template #default="scope"><span>{{ scope.row.host }}:{{ scope.row.port }}</span></template>
      </el-table-column>

      <el-table-column prop="remark" label="Notes" min-width="140" align="left" header-align="left" show-overflow-tooltip>
        <template #default="scope"><span>{{ scope.row.remark || '' }}</span></template>
      </el-table-column>

      <el-table-column prop="type" label="Type" width="120" align="center" header-align="center" show-overflow-tooltip>
        <template #default="scope">
          <span class="lm-badge" :class="typeBadgeClass(scope.row.type)">{{ typeLabel(scope.row.type) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Role" width="120" align="left" header-align="left" show-overflow-tooltip>
        <template #default="scope">
          <span class="lm-badge" :class="roleBadgeClass(getRole(scope.row))">{{ roleLabel(getRole(scope.row)) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Connections" width="130" align="right" header-align="right">
        <template #default="scope"><span class="lm-num">{{ formatNumber(getLatest(scope.row).sessions || 0) }}</span></template>
      </el-table-column>

      <slot name="extra" :get-latest="getLatest" />

      <el-table-column label="Actions" width="140" align="center" header-align="center">
        <template #default="scope">
          <div class="actions">
            <el-button link type="primary" class="act" @click="emit('select', scope.row)">
              <svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </el-button>
            <el-button link type="primary" class="act" @click="emit('edit', scope.row)">
              <svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </el-button>
            <el-button link type="danger" class="act" @click="emit('delete', scope.row.id)">
              <svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { computed, defineEmits, defineProps } from 'vue'
import { formatNumber } from '../utils/formatNumber'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  mergeBusinessSystem: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'edit', 'delete'])

const getLatest = (row) => row?.latest || {}
const getRole = (row) => {
  const lr = String(getLatest(row).role || '').toLowerCase()
  if (lr && lr !== 'unknown') return lr
  return String(row?.repl_role || '').toLowerCase()
}
const roleLabel = (r) => (r === 'master' ? 'Master' : r === 'slave' ? 'Slave' : r === 'standalone' ? 'Standalone' : 'Unknown')
const typeLabel = (t) => {
  const v = String(t || '').toLowerCase()
  if (v === 'mysql') return 'MySQL'
  if (v === 'mssql' || v === 'sqlserver') return 'MSSQL'
  if (v === 'oracle') return 'Oracle'
  return String(t || '').toUpperCase()
}
const typeBadgeClass = (t) => {
  const v = String(t || '').toLowerCase()
  if (v === 'mysql') return 'lm-badge-mysql'
  if (v === 'mssql' || v === 'sqlserver') return 'lm-badge-mssql'
  if (v === 'oracle') return 'lm-badge-oracle'
  return ''
}
const roleBadgeClass = (r) => (r === 'master' ? 'lm-badge-master' : r === 'slave' ? 'lm-badge-slave' : r === 'standalone' ? 'lm-badge-standalone' : '')

const businessSystemSpans = computed(() => {
  const rows = props.rows || []
  const spans = new Array(rows.length).fill(0)
  let i = 0
  while (i < rows.length) {
    const biz = rows[i].system_name || ''
    let j = i + 1
    while (j < rows.length && (rows[j].system_name || '') === biz) j++
    spans[i] = j - i
    for (let k = i + 1; k < j; k++) spans[k] = 0
    i = j
  }
  return spans
})

const spanMethod = ({ rowIndex, column }) => {
  if (column?.property !== 'system_name') return { rowspan: 1, colspan: 1 }
  const rowspan = businessSystemSpans.value[rowIndex] || 0
  if (rowspan <= 0) return { rowspan: 0, colspan: 0 }
  return { rowspan, colspan: 1 }
}
</script>

<style scoped>
.db-name { display: inline-block; }
.status-cell { display: inline-flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 9999px; display: inline-block; }
.dot-ok { background: #10b981; }
.dot-bad { background: #ef4444; }
.status-text { color: #374151; }
.actions { display: inline-flex; align-items: center; gap: 6px; }
.act { padding: 0; }
.act-ico { width: 16px; height: 16px; }
.lm-table-toolbar { padding: 12px 12px; border-bottom: 1px solid var(--lm-table-row-sep); background: #fff; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lm-table-card :deep(.el-table__cell) { padding-top: 6px; padding-bottom: 6px; }
.lm-table-card :deep(.el-table__header th.el-table__cell .cell),
.lm-table-card :deep(.el-table__body td.el-table__cell .cell) { padding-left: 10px; padding-right: 10px; }
.lm-table-card :deep(.el-table__header th.el-table__cell:first-child .cell),
.lm-table-card :deep(.el-table__body td.el-table__cell:first-child .cell) { padding-left: 16px; }
.lm-table-card :deep(.el-table__header th.el-table__cell:last-child .cell),
.lm-table-card :deep(.el-table__body td.el-table__cell:last-child .cell) { padding-right: 16px; }
</style>

