<template>
  <div>
    <div class="page-header">
      <h1 class="app-title">LightMonitor 数据库监控中心</h1>
      <div class="page-actions">
        <el-input v-model="keyword" clearable placeholder="按 IP / 业务系统搜索" style="width: 320px" />
        <el-button type="primary" @click="dialogVisible = true">+ 新增数据库</el-button>
      </div>
    </div>

    <el-card class="box-card">
      <el-table :data="filteredData" border stripe empty-text="暂无数据，请在上方添加">
        <el-table-column label="状态" width="100" align="center">
          <template #default="scope">
            <el-tag :type="getLatest(scope.row).online ? 'success' : 'danger'" effect="dark">{{ getLatest(scope.row).online ? '在线' : '离线' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="数据库别名" />
        <el-table-column prop="business_system" label="业务系统" width="150" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="120" align="center">
          <template #default="scope">
            <el-tag effect="plain">{{ scope.row.type.toUpperCase() }}</el-tag>
            <el-tag v-if="getRole(scope.row) === 'slave'" type="warning" effect="plain" size="small" style="margin-left:5px">从</el-tag>
            <el-tag v-else-if="getRole(scope.row) === 'master'" type="success" effect="plain" size="small" style="margin-left:5px">主</el-tag>
            <el-tag v-else-if="getRole(scope.row) === 'standalone'" type="info" effect="plain" size="small" style="margin-left:5px">单</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="地址" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.host }}:{{ scope.row.port }}</template>
        </el-table-column>
        <el-table-column label="连接数" width="120" align="right">
          <template #default="scope"><b style="color: #409EFF; font-size: 16px;">{{ getLatest(scope.row).sessions || 0 }}</b></template>
        </el-table-column>
        <el-table-column label="QPS" width="100" align="right">
          <template #default="scope">{{ getLatest(scope.row).qps || 0 }}</template>
        </el-table-column>
        <el-table-column label="TPS" width="100" align="right">
          <template #default="scope">{{ getLatest(scope.row).tps || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="center">
          <template #default="scope">
            <el-button link type="primary" size="small" @click="enterDetail(scope.row)">🔍 进入监控</el-button>
            <span style="color: #e0e0e0; margin: 0 5px;">|</span>
            <el-button link type="primary" size="small" @click="openEdit(scope.row)">编辑</el-button>
            <span style="color: #e0e0e0; margin: 0 5px;">|</span>
            <el-button link type="danger" size="small" @click="handleDelete(scope.row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增数据库" width="900px" destroy-on-close>
      <AddTargetForm embedded @saved="handleSaved" />
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑数据库" width="900px" destroy-on-close>
      <AddTargetForm embedded mode="edit" :target="editingTarget" @saved="handleEditSaved" />
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, defineEmits, ref, computed } from 'vue'
import AddTargetForm from './AddTargetForm.vue'
import { useApi } from '../composables/useApi'

const emit = defineEmits(['select'])
const { tableData, fetchList, deleteTarget } = useApi()

let timer = null

const keyword = ref('')
const dialogVisible = ref(false)
const editDialogVisible = ref(false)
const editingTarget = ref(null)
const filteredData = computed(() => {
  const k = (keyword.value || '').trim().toLowerCase()
  if (!k) return tableData.value
  return (tableData.value || []).filter(r => {
    const host = (r.host || '').toLowerCase()
    const addr = `${r.host || ''}:${r.port || ''}`.toLowerCase()
    const biz = (r.business_system || '').toLowerCase()
    return host.includes(k) || addr.includes(k) || biz.includes(k)
  })
})

const getLatest = (row) => row.latest || {}
const getRole = (row) => (getLatest(row).role || row.repl_role || '').toLowerCase()

const enterDetail = (row) => {
  emit('select', row)
}

const openEdit = (row) => {
  editingTarget.value = { ...row }
  editDialogVisible.value = true
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
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
.app-title { margin: 0; color: #303133; }
.page-actions { display: flex; align-items: center; gap: 10px; }
</style>
