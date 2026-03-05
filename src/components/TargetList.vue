<template>
  <div>
    <div class="lm-header">
      <div class="lm-header-left">
        <h1 class="lm-title">LightMonitor 数据库监控中心</h1>
      </div>
      <div class="lm-header-right">
        <el-input v-model="keyword" clearable placeholder="按 IP / 业务系统搜索" style="width: 320px" />
        <el-button type="primary" :icon="Plus" @click="dialogVisible = true">新增数据库</el-button>
      </div>
    </div>

    <el-card class="box-card">
      <el-table :data="sortedData" :span-method="spanMethod" :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontWeight: 'bold' }" border empty-text="暂无数据，请在上方添加">
        <el-table-column label="状态" width="80" align="center">
          <template #default="scope">
            <el-tag :type="getLatest(scope.row).online ? 'success' : 'danger'" effect="dark">{{ getLatest(scope.row).online ? '在线' : '离线' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="数据库别名" min-width="150" align="left" header-align="left">
          <template #default="scope">
            <span class="cell-pad-left db-name" :class="{ 'db-name-slave': getRole(scope.row) === 'slave' }">{{ scope.row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="business_system" label="业务系统" min-width="200" show-overflow-tooltip align="left" header-align="left" />
        <el-table-column prop="type" label="类型" width="160" align="center">
          <template #default="scope">
            <div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
              <el-tag effect="plain">{{ (scope.row.type || '').toUpperCase() }}</el-tag>
              <el-tag v-if="getRole(scope.row) === 'master'" type="success" effect="dark">主</el-tag>
              <el-tag v-else-if="getRole(scope.row) === 'slave'" type="info" effect="plain">从</el-tag>
              <el-tag v-else-if="getRole(scope.row) === 'standalone'" type="info" effect="plain">单</el-tag>
              <el-tag v-else type="info" effect="plain">未知</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="地址" min-width="200" align="left" header-align="left">
          <template #default="scope"><span class="cell-pad-left" style="white-space: nowrap;">{{ scope.row.host }}:{{ scope.row.port }}</span></template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip align="left" header-align="left" />
        <el-table-column label="连接数" width="100" align="right" header-align="center">
          <template #default="scope"><b style="color: #409EFF; font-size: 16px; font-family: Consolas, monospace;">{{ getLatest(scope.row).sessions || 0 }}</b></template>
        </el-table-column>
        <el-table-column label="QPS" width="100" align="right" header-align="center">
          <template #default="scope"><span style="font-family: Consolas, monospace;">{{ getLatest(scope.row).qps || 0 }}</span></template>
        </el-table-column>
        <el-table-column label="TPS" width="100" align="right" header-align="center">
          <template #default="scope"><span style="font-family: Consolas, monospace;">{{ getLatest(scope.row).tps || 0 }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="scope">
            <el-button link type="primary" size="small" @click="enterDetail(scope.row)">进入监控</el-button>
            <span style="color: #e0e0e0; margin: 0 5px;">|</span>
            <el-button link type="primary" size="small" @click="openEdit(scope.row)">编辑</el-button>
            <span style="color: #e0e0e0; margin: 0 5px;">|</span>
            <el-button link type="danger" size="small" @click="handleDelete(scope.row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增监控目标" width="600px" draggable destroy-on-close>
      <AddTargetForm ref="addFormRef" @saved="handleSaved" />
      <template #footer>
        <div class="dialog-footer">
          <div>
            <el-button :loading="addTesting" @click="handleAddTest">测试</el-button>
          </div>
          <div class="dialog-footer-right">
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="addSaving" @click="handleAddSave">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑监控目标" width="600px" draggable destroy-on-close>
      <AddTargetForm ref="editFormRef" mode="edit" :target="editingTarget" @saved="handleEditSaved" />
      <template #footer>
        <div class="dialog-footer">
          <div></div>
          <div class="dialog-footer-right">
            <el-button @click="handleEditCancel">取消</el-button>
            <el-button type="primary" :loading="editSaving" @click="handleEditSave">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, defineEmits, ref, computed } from 'vue'
import AddTargetForm from './AddTargetForm.vue'
import { useApi } from '../composables/useApi'
import { Plus } from '@element-plus/icons-vue'

const emit = defineEmits(['select'])
const { tableData, fetchList, deleteTarget } = useApi()

let timer = null

const keyword = ref('')
const dialogVisible = ref(false)
const editDialogVisible = ref(false)
const editingTarget = ref(null)
const addFormRef = ref(null)
const editFormRef = ref(null)

const addSaving = computed(() => !!addFormRef.value?.saving?.value)
const addTesting = computed(() => !!addFormRef.value?.testing?.value)
const editSaving = computed(() => !!editFormRef.value?.saving?.value)
const filteredFlatData = computed(() => {
  const k = (keyword.value || '').trim().toLowerCase()
  if (!k) return tableData.value
  return (tableData.value || []).filter(r => {
    const name = (r.name || '').toLowerCase()
    const host = (r.host || '').toLowerCase()
    const addr = `${r.host || ''}:${r.port || ''}`.toLowerCase()
    const biz = (r.business_system || '').toLowerCase()
    const remark = (r.remark || '').toLowerCase()
    return name.includes(k) || host.includes(k) || addr.includes(k) || biz.includes(k) || remark.includes(k)
  })
})

const getLatest = (row) => row.latest || {}
const getRole = (row) => (getLatest(row).role || row.repl_role || '').toLowerCase()

const sortedData = computed(() => {
  const rows = (filteredFlatData.value || []).map(r => ({ ...r }))
  rows.sort((a, b) => {
    const bizA = (a.business_system || '').toLowerCase()
    const bizB = (b.business_system || '').toLowerCase()
    if (bizA !== bizB) return bizA.localeCompare(bizB)
    const ra = getRole(a)
    const rb = getRole(b)
    const wa = ra === 'master' ? 0 : ra === 'slave' ? 1 : ra === 'standalone' ? 2 : 3
    const wb = rb === 'master' ? 0 : rb === 'slave' ? 1 : rb === 'standalone' ? 2 : 3
    if (wa !== wb) return wa - wb
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
  return rows
})

const businessSystemSpans = computed(() => {
  const rows = sortedData.value || []
  const spans = new Array(rows.length).fill(0)
  let i = 0
  while (i < rows.length) {
    const biz = rows[i].business_system || ''
    let j = i + 1
    while (j < rows.length && (rows[j].business_system || '') === biz) j++
    spans[i] = j - i
    for (let k = i + 1; k < j; k++) spans[k] = 0
    i = j
  }
  return spans
})

const spanMethod = ({ rowIndex, column }) => {
  if (column?.property !== 'business_system') return { rowspan: 1, colspan: 1 }
  const rowspan = businessSystemSpans.value[rowIndex] || 0
  if (rowspan <= 0) return { rowspan: 0, colspan: 0 }
  return { rowspan, colspan: 1 }
}

const enterDetail = (row) => {
  emit('select', row)
}

const openEdit = (row) => {
  editingTarget.value = { ...row }
  editDialogVisible.value = true
}

const handleAddTest = () => {
  addFormRef.value?.testConnection?.()
}

const handleAddSave = () => {
  addFormRef.value?.saveTarget?.()
}

const handleEditSave = () => {
  editFormRef.value?.saveTarget?.()
}

const handleEditCancel = () => {
  editDialogVisible.value = false
  editingTarget.value = null
}

const handleDelete = async (id) => {
  await deleteTarget(id)
  fetchList()
}

const handleSaved = () => {
  dialogVisible.value = false
  fetchList()
}

const handleEditSaved = () => {
  editDialogVisible.value = false
  editingTarget.value = null
  fetchList()
}

onMounted(() => {
  fetchList()
  timer = setInterval(fetchList, 3000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.dialog-footer { display: flex; align-items: center; justify-content: space-between; }
.dialog-footer-right { display: flex; gap: 10px; }
.cell-pad-left { padding-left: 8px; }
.db-name { display: inline-block; }
.db-name-slave { padding-left: 15px; }
</style>
