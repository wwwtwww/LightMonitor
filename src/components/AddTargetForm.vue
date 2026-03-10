<template>
  <el-form :model="form" size="default" label-width="80px">
    <el-row :gutter="20">
      <el-col :span="12">
        <el-form-item label="Type">
          <el-select v-model="form.type">
            <el-option label="MySQL" value="mysql" />
            <el-option label="Oracle" value="oracle" />
            <el-option label="MSSQL" value="mssql" />
          </el-select>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="Role">
          <el-select v-model="form.repl_role">
            <el-option label="Standalone" value="standalone" />
            <el-option label="Master" value="master" />
            <el-option label="Slave" value="slave" />
          </el-select>
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="Name">
          <el-input v-model="form.name" placeholder="Database alias" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="System">
          <el-input v-model="form.business_system" placeholder="System name" />
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="Host">
          <el-input v-model="form.host" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="Port">
          <el-input v-model.number="form.port" />
        </el-form-item>
      </el-col>

      <el-col :span="12">
        <el-form-item label="User">
          <el-input v-model="form.user" />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="Password">
          <el-input v-model="form.password" :placeholder="passwordPlaceholder" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-col>

      <el-col :span="12" v-if="String(form.type || '').toLowerCase() === 'oracle'">
        <el-form-item label="Service">
          <el-input v-model="form.options.serviceName" placeholder="e.g. ORCL / orclpdb1" />
        </el-form-item>
      </el-col>

      <el-col :span="24">
        <el-form-item label="Notes">
          <el-input v-model="form.remark" type="textarea" :rows="3" placeholder="Optional notes" />
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

const form = ref({ id: '', name: '', business_system: '', repl_role: 'standalone', remark: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '', options: { serviceName: 'ORCL' } })
const saving = ref(false)
const testing = ref(false)

const isEdit = computed(() => props.mode === 'edit')
const passwordPlaceholder = computed(() => isEdit.value ? 'Leave blank to keep unchanged' : '')

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
    password: '',
    options: t.options || {}
  }
  if (!form.value.options) form.value.options = {}
  if (String(form.value.type || '').toLowerCase() === 'oracle' && !form.value.options.serviceName) form.value.options.serviceName = 'ORCL'
}

watch(() => props.target, (t) => {
  if (isEdit.value) fillFromTarget(t)
}, { immediate: true })

const defaultsForType = (t) => {
  const type = String(t || '').toLowerCase()
  if (type === 'mysql') return { port: 3306, user: 'root' }
  if (type === 'mssql') return { port: 1433, user: 'sa' }
  if (type === 'oracle') return { port: 1521, user: 'system' }
  return { port: 0, user: '' }
}

watch(() => form.value.type, (t, prev) => {
  if (isEdit.value) return
  const prevDefaults = defaultsForType(prev)
  const nextDefaults = defaultsForType(t)
  if (form.value.port === prevDefaults.port) form.value.port = nextDefaults.port
  if (form.value.user === prevDefaults.user) form.value.user = nextDefaults.user
  if (String(t || '').toLowerCase() === 'oracle') {
    if (!form.value.options) form.value.options = {}
    if (!form.value.options.serviceName) form.value.options.serviceName = 'ORCL'
  }
})

const testConnection = async () => {
  if (testing.value) return
  if (isEdit.value && !form.value.password) {
    ElMessage.warning('In edit mode, enter a password before testing')
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
      ElMessage.error(`Connection test failed: ${detail}`)
      return
    }
    ElMessage.success(`Connection test passed${typeof r.latencyMs === 'number' ? ` (${r.latencyMs}ms)` : ''}`)
  } catch (e) {
    const d = e?.response?.data
    const msg = d?.detail || d?.error || d?.message || e?.message || 'Test failed'
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
        ElMessage.error(`Connection test failed: ${detail}`)
        return
      }
      await axios.post(`${API_URL}/databases`, payload)
    }
    ElMessage.success('Saved')
    emit('saved')
    if (!isEdit.value) {
      form.value = { id: '', name: '', business_system: '', repl_role: 'standalone', remark: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '', options: { serviceName: 'ORCL' } }
    } else {
      form.value.password = ''
    }
  } catch (e) {
    const d = e?.response?.data
    const msg = d?.detail || d?.error || d?.message || e?.message || 'Save failed'
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
