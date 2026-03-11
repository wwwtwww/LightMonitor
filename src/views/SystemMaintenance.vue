<template>
  <div>
    <div class="lm-header">
      <div class="lm-header-left">
        <h1 class="lm-title">System Maintenance</h1>
      </div>
      <div class="lm-header-right">
        <el-button @click="refreshAll">Refresh</el-button>
      </div>
    </div>

    <el-card shadow="never" class="lm-table-card" style="margin-bottom: var(--lm-space-4);">
      <template #header>
        <div class="panel-header">
          <b>Status Dashboard</b>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :span="8">
          <div class="info-item">
            <div class="info-label">Database file size</div>
            <div class="info-value highlight">{{ stats.db_size_mb ?? 0 }} MB</div>
            <div class="info-sub">Total (incl. WAL/SHM): {{ stats.db_total_size_mb ?? 0 }} MB</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="info-item">
            <div class="info-label">Metrics rows</div>
            <div class="info-value lm-num">{{ metricsRows === null ? '—' : formatNumber(metricsRows) }}</div>
            <div class="info-sub">
              <span v-if="metricsRows === null">Estimated, load manually</span>
              <span v-else>From metrics table</span>
              <el-button v-if="metricsRows === null" link size="small" :loading="loadingCounts" @click="loadMetricsRows">Load</el-button>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="info-item">
            <div class="info-label">Targets</div>
            <div class="info-value lm-num">{{ formatNumber(stats.monitor_targets ?? stats.targets_rows ?? 0) }}</div>
            <div class="info-sub">From targets table</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card shadow="never" class="lm-table-card" style="margin-bottom: var(--lm-space-4);">
      <template #header>
        <div class="panel-header">
          <b>Retention Policy</b>
        </div>
      </template>
      <el-form :model="form" label-width="110px" class="form">
        <el-form-item label="Retention days">
          <el-input-number v-model="form.retention_days" :min="1" :max="3650" controls-position="right" />
          <span class="hint">Default: 7 days</span>
        </el-form-item>
        <el-form-item label="Cleanup time">
          <el-time-picker v-model="form.cleanup_time" format="HH:mm" value-format="HH:mm" :clearable="false" />
          <span class="hint">Default: 03:00</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveConfig">Save</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="lm-table-card">
      <template #header>
        <div class="panel-header">
          <b>Actions</b>
        </div>
      </template>
      <div class="op-row">
        <div class="op-desc">Clean up old data and vacuum the database. This may block briefly.</div>
        <el-button type="danger" :loading="cleaning" @click="runCleanup">Run Cleanup & Vacuum</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useApi } from '../composables/useApi'
import { formatNumber } from '../utils/formatNumber'

const { getMaintenanceStats, getMaintenanceConfig, saveMaintenanceConfig, runMaintenanceCleanup } = useApi()

const stats = reactive({})
const form = reactive({
  retention_days: 7,
  cleanup_time: '03:00'
})

const saving = ref(false)
const cleaning = ref(false)
const loadingCounts = ref(false)

const metricsRows = computed(() => {
  const v = stats.monitor_logs ?? stats.metrics_rows
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
})

const refreshStats = async () => {
  const s = await getMaintenanceStats(false)
  Object.assign(stats, s || {})
}

const loadMetricsRows = async () => {
  loadingCounts.value = true
  try {
    const s = await getMaintenanceStats(true)
    Object.assign(stats, s || {})
  } finally {
    loadingCounts.value = false
  }
}

const refreshConfig = async () => {
  const cfg = await getMaintenanceConfig()
  form.retention_days = cfg?.retention_days ?? 7
  form.cleanup_time = cfg?.cleanup_time ?? '03:00'
}

const refreshAll = async () => {
  await Promise.all([refreshStats(), refreshConfig()])
}

const saveConfig = async () => {
  saving.value = true
  try {
    const payload = {
      retention_days: Number(form.retention_days) || 7,
      cleanup_time: String(form.cleanup_time || '03:00')
    }
    const r = await saveMaintenanceConfig(payload)
    form.retention_days = r?.retention_days ?? payload.retention_days
    form.cleanup_time = r?.cleanup_time ?? payload.cleanup_time
    ElMessage.success('Saved')
  } catch {
    ElMessage.error('Save failed')
  } finally {
    saving.value = false
  }
}

const runCleanup = async () => {
  try {
    await ElMessageBox.confirm('This will delete old data and run VACUUM. Continue?', 'Confirm', { type: 'warning' })
  } catch {
    return
  }
  cleaning.value = true
  ElMessage.warning('Running cleanup and vacuum...')
  try {
    const r = await runMaintenanceCleanup(Number(form.retention_days) || 7, { vacuum: true })
    const before = r?.db_total_size_mb_before ?? r?.db_size_mb_before
    const after = r?.db_total_size_mb_after ?? r?.db_size_mb_after
    ElMessage.success(`Done: deleted ${formatNumber(r?.deleted_rows ?? 0)} rows, size ${before}MB → ${after}MB`)
    await refreshStats()
  } catch {
    ElMessage.error('Cleanup failed')
  } finally {
    cleaning.value = false
  }
}

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.form { max-width: 560px; }
.hint { margin-left: 10px; font-size: 12px; color: var(--lm-muted); }
.info-item { background: #fff; border-radius: var(--lm-radius-md); padding: var(--lm-space-3) var(--lm-space-4); border: var(--lm-border); }
.info-label { font-size: 12px; color: var(--lm-muted); }
.info-value { margin-top: 6px; font-size: 22px; font-weight: 900; color: var(--lm-text); }
.info-sub { margin-top: 4px; font-size: 12px; color: var(--lm-muted-2); }
.highlight { color: #1677ff; }
.op-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.op-desc { color: var(--lm-muted); font-size: 13px; }
</style>

