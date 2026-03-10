<template>
  <div>
    <TargetsStatsBar :rows="rows" />

    <div class="lm-titlebar">
      <h1 class="lm-title">MSSQL</h1>
    </div>

    <TargetsTable
      :rows="treeRows"
      @select="emit('select', $event)"
      @edit="editorRef?.openEdit($event)"
      @delete="handleDelete"
    >
      <template #toolbar>
        <el-input v-model="keyword" clearable placeholder="Search by System Name, Alias, or IP..." style="max-width: 520px" class="lm-search">
          <template #prefix>
            <svg class="lm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </template>
        </el-input>
        <el-button type="primary" :icon="Plus" @click="editorRef?.openAdd()">Add Database</el-button>
      </template>
      <template #extra="{ getLatest }">
        <el-table-column label="QPS(Batch)" width="130" align="right" header-align="right" show-overflow-tooltip>
          <template #default="scope"><span class="lm-num">{{ formatNumber(getLatest(scope.row).qps || 0, 2) }}</span></template>
        </el-table-column>
        <el-table-column label="PLE(s)" width="110" align="right" header-align="right" show-overflow-tooltip>
          <template #default="scope"><span class="lm-num">{{ formatNumber(parseExtra(getLatest(scope.row)).ple ?? 0) }}</span></template>
        </el-table-column>
        <el-table-column label="Compilations/s" width="150" align="right" header-align="right" show-overflow-tooltip>
          <template #default="scope"><span class="lm-num">{{ formatNumber(parseExtra(getLatest(scope.row)).compilationsPerSec ?? 0, 2) }}</span></template>
        </el-table-column>
      </template>
    </TargetsTable>

    <TargetEditor ref="editorRef" @changed="refresh" />
  </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import TargetsTable from '../components/TargetsTable.vue'
import TargetEditor from '../components/TargetEditor.vue'
import { formatNumber } from '../utils/formatNumber'
import TargetsStatsBar from '../components/TargetsStatsBar.vue'
import { buildTargetTree, filterTree } from '../utils/targetTree'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  refresh: { type: Function, required: true },
  deleteTarget: { type: Function, required: true }
})

const emit = defineEmits(['select'])

const editorRef = ref(null)
const keyword = ref('')

const parseExtra = (latest) => {
  try {
    const s = latest?.extra_data
    if (!s) return {}
    if (typeof s === 'object') return s
    return JSON.parse(String(s))
  } catch {
    return {}
  }
}

const mssqlRows = computed(() => (props.rows || []).filter(r => {
  const t = (r.type || '').toLowerCase()
  return t === 'mssql'
}))

const treeRows = computed(() => {
  const tree = buildTargetTree(mssqlRows.value || [])
  return filterTree(tree, keyword.value)
})

const refresh = async () => {
  await props.refresh()
}

const handleDelete = async (id) => {
  await props.deleteTarget(id)
  await refresh()
}
</script>

