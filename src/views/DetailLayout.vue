<template>
  <div>
    <div class="lm-header">
      <div class="lm-header-left">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>
            <span class="crumb-link" @click="emit('back')">Monitoring</span>
          </el-breadcrumb-item>
          <el-breadcrumb-item>
            <span class="crumb-link" @click="emit('back')">{{ typeText }}</span>
          </el-breadcrumb-item>
          <el-breadcrumb-item>{{ crumbSystem }}</el-breadcrumb-item>
        </el-breadcrumb>
      </div>

      <div class="lm-header-right">
        <el-radio-group v-model="timeRange" size="small" @change="handleRangeChange">
          <el-radio-button label="1">Last 1h</el-radio-button>
          <el-radio-button label="3">Last 3h</el-radio-button>
          <el-radio-button label="6">Last 6h</el-radio-button>
          <el-radio-button label="24">Last 24h</el-radio-button>
        </el-radio-group>

        <el-popover
          v-model:visible="customPopoverVisible"
          trigger="click"
          placement="bottom-start"
          :width="300"
          @show="syncCustomDraft"
        >
          <template #reference>
            <el-button size="small" :type="customActive ? 'primary' : 'default'">{{ customButtonText }}</el-button>
          </template>

          <div class="custom-popover">
            <div class="custom-field">
              <div class="custom-label">Start</div>
              <el-date-picker
                v-model="customStartTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                :disabled-date="disableStartDate"
                style="width: 100%;"
              />
            </div>
            <div class="custom-field">
              <div class="custom-label">End</div>
              <el-date-picker
                v-model="customEndTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm:ss"
                :disabled-date="disableEndDate"
                style="width: 100%;"
              />
            </div>

            <div class="custom-actions">
              <el-button size="small" @click="handleCustomCancel">Cancel</el-button>
              <el-button size="small" type="primary" :disabled="!canApplyCustom" @click="handleCustomApply">Apply</el-button>
            </div>
          </div>
        </el-popover>

        <div class="auto-refresh">
          <span class="auto-refresh-label">Auto Refresh</span>
          <el-switch v-model="autoRefresh" size="small" />
        </div>
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <el-card class="summary-card" shadow="never">
        <div class="instance-title">
          <div>
            <div class="instance-name">{{ target.name || '—' }}</div>
            <div class="instance-sub">{{ hostText }}</div>
          </div>
          <div class="status-cell">
            <span class="dot" :class="latest.online ? 'dot-ok' : 'dot-bad'" aria-hidden="true"></span>
            <span class="status-text">{{ latest.online ? 'Online' : 'Offline' }}</span>
          </div>
        </div>

        <div class="instance-meta">
          <div class="meta-row">
            <div class="meta-label">Badges</div>
            <div class="meta-value">
              <div class="badges">
                <span class="lm-badge" :class="typeBadgeClass">{{ typeText }}</span>
                <span class="lm-badge" :class="roleBadgeClass">{{ roleLabel(roleValue) }}</span>
              </div>
            </div>
          </div>
          <div class="meta-row">
            <div class="meta-label">System Name</div>
            <div class="meta-value">{{ crumbSystem }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <component
      :is="panelComponent"
      :target="target"
      :range-params="rangeParams"
      :range-text="rangeText"
      :is-live="isLive"
      :auto-refresh="autoRefresh"
      :db-type="(target.type || '')"
    />
  </div>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from 'vue'
import { formatNumber } from '../utils/formatNumber'
import MysqlPanel from '../panels/MysqlPanel.vue'
import SqlServerPanel from '../panels/SqlServerPanel.vue'
import OraclePanel from '../panels/OraclePanel.vue'
import UnsupportedPanel from '../panels/UnsupportedPanel.vue'

const props = defineProps({
  target: { type: Object, required: true }
})

const emit = defineEmits(['back'])

const timeRange = ref('1')
const customPopoverVisible = ref(false)
const customStartTime = ref('')
const customEndTime = ref('')
const appliedCustomStartTime = ref('')
const appliedCustomEndTime = ref('')
const autoRefresh = ref(true)

const latest = computed(() => props.target.latest || {})
const hostText = computed(() => [props.target.host, props.target.port].filter(Boolean).join(':') || '—')
const typeText = computed(() => (props.target.type || '').toUpperCase() || '—')
const typeValue = computed(() => String(props.target.type || '').toLowerCase())
const crumbSystem = computed(() => props.target.system_name || props.target.business_system || props.target.name || '—')

const roleValue = computed(() => {
  const lr = String(latest.value.role || '').toLowerCase()
  if (lr && lr !== 'unknown') return lr
  return String(props.target.repl_role || '').toLowerCase()
})
const roleLabel = (r) => (r === 'master' ? 'Master' : r === 'slave' ? 'Slave' : r === 'standalone' ? 'Standalone' : 'Unknown')
const typeBadgeClass = computed(() => (typeValue.value === 'mysql' ? 'lm-badge-mysql' : typeValue.value === 'mssql' ? 'lm-badge-mssql' : typeValue.value === 'oracle' ? 'lm-badge-oracle' : ''))
const roleBadgeClass = computed(() => (roleValue.value === 'master' ? 'lm-badge-master' : roleValue.value === 'slave' ? 'lm-badge-slave' : roleValue.value === 'standalone' ? 'lm-badge-standalone' : ''))

const customActive = computed(() => !!(appliedCustomStartTime.value && appliedCustomEndTime.value))
const isLive = computed(() => !customActive.value)

const parseDate = (s) => {
  const str = String(s || '').trim()
  if (!str) return null
  const d = new Date(str.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return null
  return d
}

const formatShort = (s) => {
  const d = parseDate(s)
  if (!d) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

const customButtonText = computed(() => {
  if (!customActive.value) return '📅 Custom Range'
  return `${formatShort(appliedCustomStartTime.value)} ~ ${formatShort(appliedCustomEndTime.value)}`
})

const canApplyCustom = computed(() => {
  const s = parseDate(customStartTime.value)
  const e = parseDate(customEndTime.value)
  if (!s || !e) return false
  return s.getTime() <= e.getTime()
})

const disableStartDate = (d) => d.getTime() > Date.now()
const disableEndDate = (d) => {
  const t = d.getTime()
  if (t > Date.now()) return true
  const s = parseDate(customStartTime.value)
  if (!s) return false
  const endDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()
  return endDay < startDay
}

const rangeText = computed(() => {
  if (customActive.value) return `${appliedCustomStartTime.value} ~ ${appliedCustomEndTime.value}`
  return `Last ${timeRange.value || '1'}h`
})

const rangeParams = computed(() => {
  if (customActive.value) {
    const from = parseDate(appliedCustomStartTime.value)?.getTime()
    const to = parseDate(appliedCustomEndTime.value)?.getTime()
    return {
      from,
      to
    }
  }
  return { range: `${timeRange.value || '1'}h` }
})

const panelComponent = computed(() => {
  const t = (props.target.type || '').toLowerCase()
  if (t === 'mysql') return MysqlPanel
  if (t === 'mssql') return SqlServerPanel
  if (t === 'oracle') return OraclePanel
  return UnsupportedPanel
})

const clearCustomApplied = () => {
  appliedCustomStartTime.value = ''
  appliedCustomEndTime.value = ''
  customStartTime.value = ''
  customEndTime.value = ''
  customPopoverVisible.value = false
}

const syncCustomDraft = () => {
  customStartTime.value = appliedCustomStartTime.value || ''
  customEndTime.value = appliedCustomEndTime.value || ''
}

const handleRangeChange = () => {
  clearCustomApplied()
}

const handleCustomCancel = () => {
  syncCustomDraft()
  customPopoverVisible.value = false
}

const handleCustomApply = () => {
  if (!canApplyCustom.value) return
  appliedCustomStartTime.value = customStartTime.value
  appliedCustomEndTime.value = customEndTime.value
  timeRange.value = ''
  autoRefresh.value = false
  customPopoverVisible.value = false
}
</script>

<style scoped>
.crumb-link { cursor: pointer; color: var(--lm-muted); }
.crumb-link:hover { color: var(--lm-text); }
.auto-refresh { display: flex; align-items: center; gap: 8px; }
.auto-refresh-label { font-size: 12px; color: #6b7280; }
.lm-header { position: sticky; top: 16px; z-index: 20; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(10px); }
.summary-card { border-radius: 12px; border: var(--lm-border); box-shadow: var(--lm-shadow-sm); }
.summary-card :deep(.el-card__body) { padding: 14px 14px; }
.instance-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.instance-name { font-size: 16px; font-weight: 800; color: var(--lm-text); line-height: 1.2; }
.instance-sub { margin-top: 4px; font-size: 12px; color: var(--lm-muted); }
.status-cell { display: inline-flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 9999px; display: inline-block; }
.dot-ok { background: #10b981; }
.dot-bad { background: #ef4444; }
.status-text { color: #374151; font-weight: 700; font-size: 13px; }
.instance-meta { margin-top: 12px; display: grid; grid-template-columns: 1fr; gap: 10px; }
.meta-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.meta-label { font-size: 11px; color: var(--lm-muted); }
.meta-value { font-size: 13px; font-weight: 700; color: var(--lm-text); text-align: right; }
.badges { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.custom-popover { display: flex; flex-direction: column; gap: 10px; }
.custom-field { display: flex; flex-direction: column; gap: 6px; }
.custom-label { font-size: 12px; color: #6b7280; }
.custom-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
@media (max-width: 1100px) {
}
@media (max-width: 720px) {
  .lm-header { top: 0; border-radius: 0; }
}
</style>

