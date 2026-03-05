<template>
  <el-card v-if="!embedded" class="box-card" style="margin-bottom: 20px;">
    <template #header><div class="card-header"><span>{{ headerText }}</span></div></template>
    <el-form :inline="true" :model="form" size="default">
      <el-form-item label="名称"><el-input v-model="form.name" style="width: 150px" placeholder="数据库别名"/></el-form-item>
      <el-form-item label="业务系统"><el-input v-model="form.business_system" style="width: 150px" placeholder="所属业务"/></el-form-item>
      <el-form-item label="主从角色">
        <el-select v-model="form.repl_role" style="width: 100px">
          <el-option label="单机" value="standalone" />
          <el-option label="主库" value="master" />
          <el-option label="从库" value="slave" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="form.type" style="width: 120px">
          <el-option label="MySQL" value="mysql" /><el-option label="Oracle" value="oracle" /><el-option label="SQL Server" value="sqlserver" />
        </el-select>
      </el-form-item>
      <el-form-item label="IP"><el-input v-model="form.host" style="width: 140px"/></el-form-item>
      <el-form-item label="端口"><el-input v-model.number="form.port" style="width: 80px"/></el-form-item>
      <el-form-item label="用户"><el-input v-model="form.user" style="width: 100px"/></el-form-item>
      <el-form-item label="密码"><el-input v-model="form.password" :placeholder="passwordPlaceholder" type="password" show-password autocomplete="new-password" style="width: 100px"/></el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveTarget">{{ saveLabel }}</el-button>
      </el-form-item>
    </el-form>
  </el-card>
  <el-form v-else :inline="true" :model="form" size="default">
    <el-form-item label="名称"><el-input v-model="form.name" style="width: 150px" placeholder="数据库别名"/></el-form-item>
    <el-form-item label="业务系统"><el-input v-model="form.business_system" style="width: 150px" placeholder="所属业务"/></el-form-item>
    <el-form-item label="主从角色">
      <el-select v-model="form.repl_role" style="width: 100px">
        <el-option label="单机" value="standalone" />
        <el-option label="主库" value="master" />
        <el-option label="从库" value="slave" />
      </el-select>
    </el-form-item>
    <el-form-item label="类型">
      <el-select v-model="form.type" style="width: 120px">
        <el-option label="MySQL" value="mysql" /><el-option label="Oracle" value="oracle" /><el-option label="SQL Server" value="sqlserver" />
      </el-select>
    </el-form-item>
    <el-form-item label="IP"><el-input v-model="form.host" style="width: 140px"/></el-form-item>
    <el-form-item label="端口"><el-input v-model.number="form.port" style="width: 80px"/></el-form-item>
    <el-form-item label="用户"><el-input v-model="form.user" style="width: 100px"/></el-form-item>
    <el-form-item label="密码"><el-input v-model="form.password" :placeholder="passwordPlaceholder" type="password" show-password autocomplete="new-password" style="width: 160px"/></el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="saving" @click="saveTarget">{{ saveLabel }}</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup>
import { ref, defineEmits, defineProps, watch, computed } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const props = defineProps({
  embedded: { type: Boolean, default: false },
  mode: { type: String, default: 'create' },
  target: { type: Object, default: null }
})

const API_URL = '/api'
const emit = defineEmits(['saved'])

const form = ref({ id: '', name: '', business_system: '', repl_role: 'standalone', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' })
const saving = ref(false)

const isEdit = computed(() => props.mode === 'edit')
const headerText = computed(() => isEdit.value ? '✏️ 编辑监控目标' : '➕ 新增监控目标')
const saveLabel = computed(() => isEdit.value ? '保存修改' : '保存')
const passwordPlaceholder = computed(() => isEdit.value ? '留空保持不变' : '')

const fillFromTarget = (t) => {
  if (!t) return
  form.value = {
    id: t.id || '',
    name: t.name || '',
    business_system: t.business_system || '',
    repl_role: t.repl_role || 'standalone',
    type: t.type || 'mysql',
    host: t.host || '',
    port: t.port || null,
    user: t.user || '',
    password: ''
  }
}

watch(() => props.target, (t) => {
  if (isEdit.value) fillFromTarget(t)
}, { immediate: true })

const saveTarget = async () => {
  if (saving.value) return
  saving.value = true
  const payload = { ...form.value }
  if (!payload.password) delete payload.password
  try {
    if (isEdit.value) {
      await axios.put(`${API_URL}/databases/${payload.id}`, payload)
    } else {
      const t = await axios.post(`${API_URL}/test-connection`, payload)
      const r = t?.data
      if (!r || !r.ok || !r.online) {
        const detail = r?.detail || r?.error || 'connect_failed'
        ElMessage.error(`连通性测试失败: ${detail}`)
        return
      }
      await axios.post(`${API_URL}/databases`, payload)
    }
    ElMessage.success('保存成功')
    emit('saved')
    if (!isEdit.value) {
      form.value = { id: '', name: '', business_system: '', repl_role: 'standalone', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' }
    } else {
      form.value.password = ''
    }
  } catch (e) {
    const d = e?.response?.data
    const msg = d?.detail || d?.error || d?.message || e?.message || '保存失败'
    ElMessage.error(String(msg))
  } finally {
    saving.value = false
  }
}
</script>
