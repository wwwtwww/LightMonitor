<template>
  <el-form :model="form" size="default" label-width="80px">
    <el-row :gutter="20">
      <el-col :span="12">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="数据库别名" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="业务系统">
          <el-input v-model="form.business_system" placeholder="所属业务" />
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="IP">
          <el-input v-model="form.host" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="端口">
          <el-input v-model.number="form.port" />
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="用户">
          <el-input v-model="form.user" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="密码">
          <el-input v-model="form.password" :placeholder="passwordPlaceholder" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="主从角色">
          <el-select v-model="form.repl_role">
            <el-option label="单机" value="standalone" />
            <el-option label="主库" value="master" />
            <el-option label="从库" value="slave" />
          </el-select>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="类型">
          <el-select v-model="form.type">
            <el-option label="MySQL" value="mysql" />
            <el-option label="Oracle" value="oracle" />
            <el-option label="SQL Server" value="sqlserver" />
          </el-select>
        </el-form-item>
      </el-col>

      <el-col :span="24">
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="3" placeholder="备注信息（可选）" />
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>

<script setup>
import { ref, defineEmits, defineProps, watch, computed, defineExpose } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const props = defineProps({
  embedded: { type: Boolean, default: false },
  mode: { type: String, default: 'create' },
  target: { type: Object, default: null }
})

const API_URL = '/api'
const emit = defineEmits(['saved'])

const form = ref({ id: '', name: '', business_system: '', repl_role: 'standalone', remark: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' })
const saving = ref(false)
const testing = ref(false)

const isEdit = computed(() => props.mode === 'edit')
const passwordPlaceholder = computed(() => isEdit.value ? '留空保持不变' : '')

const fillFromTarget = (t) => {
  if (!t) return
  form.value = {
    id: t.id || '',
    name: t.name || '',
    business_system: t.business_system || '',
    repl_role: t.repl_role || 'standalone',
    remark: t.remark || '',
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

const testConnection = async () => {
  if (testing.value) return
  if (isEdit.value && !form.value.password) {
    ElMessage.warning('编辑模式下请填写密码后再测试')
    return
  }
  testing.value = true
  const payload = { ...form.value }
  if (!payload.password) delete payload.password
  try {
    const t = await axios.post(`${API_URL}/test-connection`, payload)
    const r = t?.data
    if (!r || !r.ok || !r.online) {
      const detail = r?.detail || r?.error || 'connect_failed'
      ElMessage.error(`连通性测试失败: ${detail}`)
      return
    }
    ElMessage.success(`连通性测试通过${typeof r.latencyMs === 'number' ? ` (${r.latencyMs}ms)` : ''}`)
  } catch (e) {
    const d = e?.response?.data
    const msg = d?.detail || d?.error || d?.message || e?.message || '测试失败'
    ElMessage.error(String(msg))
  } finally {
    testing.value = false
  }
}

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
      form.value = { id: '', name: '', business_system: '', repl_role: 'standalone', remark: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' }
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

defineExpose({
  saving,
  testing,
  testConnection,
  saveTarget,
})
</script>
