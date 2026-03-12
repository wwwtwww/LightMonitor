<template>
  <div class="oracle-panel">
    <div class="ops-strip">
      <div class="ops-item" role="button" tabindex="0" @click="activeTab = 'locks'">
        <div class="ops-label">Locks</div>
        <el-tag size="small" :type="lockWaitKpiNum ? 'danger' : 'info'" effect="plain">{{ lockWaitKpiText }}</el-tag>
      </div>
      <div class="ops-item" role="button" tabindex="0" @click="activeTab = 'capacity'">
        <div class="ops-label">Capacity</div>
        <el-tag size="small" :type="capacityWarn ? 'warning' : 'info'" effect="plain">{{ capacityTagText }}</el-tag>
      </div>
      <div class="ops-hint">{{ rangeText }}</div>
    </div>

    <el-card shadow="never" class="live-card">
      <template #header>
        <div class="panel-header">
          <b>KPI (Latest Snapshot)</b>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Response (ms) · Latest</div>
            <div class="info-value lm-num">{{ Math.round(Number(latestPoint.resp_time || 0)) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">QPS (Execute/s) · Latest</div>
            <div class="info-value lm-num">{{ formatNum(latestPoint.qps) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Active Sessions · Latest</div>
            <div class="info-value lm-num">{{ latestExtra.activeSessions ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Total Sessions · Latest</div>
            <div class="info-value lm-num">{{ latestPoint.sessions ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Lock Wait Sessions · Latest</div>
            <div class="info-value lm-num">{{ formatMaybeInt(latestPoint.lockWaitSessions) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Blocking Sessions · Latest</div>
            <div class="info-value lm-num">{{ formatMaybeInt(latestPoint.blockingSessions) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Tablespace Max Used · Latest</div>
            <div class="info-value lm-num">{{ formatMaybePct(latestPoint.tablespaceMaxUsed) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">FRA Used · Latest</div>
            <div class="info-value lm-num">{{ formatMaybePct(latestPoint.fraUsed) }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-tabs v-model="activeTab" class="oracle-tabs">
      <el-tab-pane label="Metrics" name="metrics">
        <section class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title">Metrics Trend</div>
            <div class="lm-section-actions">
              <span class="hint-strip">Charts show trend over range; KPI shows latest sample</span>
            </div>
          </div>

          <div class="charts-grid">
            <div class="chart-card" v-for="conf in chartConfigs" :key="conf.id">
              <div class="chart-head">
                <div class="chart-title">{{ conf.title }}</div>
                <div class="chart-agg">
                  <span>Max <b class="lm-num">{{ chartAggs[conf.id]?.max || 0 }}</b></span>
                  <span>Min <b class="lm-num">{{ chartAggs[conf.id]?.min || 0 }}</b></span>
                  <span>Avg <b class="lm-num">{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
                </div>
              </div>
              <div :id="conf.id" class="chart-canvas"></div>
            </div>
          </div>

          <div class="hint-strip">无代理模式：不采集主机 CPU/内存/磁盘/网络</div>
        </section>
      </el-tab-pane>

      <el-tab-pane :label="locksTabLabel" name="locks">
        <section class="lm-section lm-section-danger">
          <div class="lm-section-head">
            <div class="lm-section-title">Lock Wait Monitor</div>
            <div class="lm-section-actions">
              <el-button size="small" type="danger" plain @click="fetchLocksData">Refresh</el-button>
            </div>
          </div>

          <el-table :data="locksData" :border="false" stripe size="small" empty-text="No lock waits">
            <el-table-column prop="blockedBy" label="Blocking SID" width="120" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ formatMaybeInt(scope.row.blockedBy) }}</span></template>
            </el-table-column>
            <el-table-column prop="sid" label="Waiting SID" width="120" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ formatMaybeInt(scope.row.sid) }}</span></template>
            </el-table-column>
            <el-table-column prop="waitingSec" label="Wait (s)" width="110" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ Number(scope.row.waitingSec || 0) }}</span></template>
            </el-table-column>
            <el-table-column prop="object" label="Object" min-width="180" show-overflow-tooltip />
            <el-table-column prop="sqlId" label="SQL ID" width="150" show-overflow-tooltip>
              <template #default="scope"><span class="lm-num">{{ scope.row.sqlId || '' }}</span></template>
            </el-table-column>
            <el-table-column prop="event" label="Event" min-width="240" show-overflow-tooltip />
          </el-table>
        </section>
      </el-tab-pane>

      <el-tab-pane label="Capacity" name="capacity">
        <section class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title">Tablespace Monitor</div>
            <div class="lm-section-actions">
              <el-button size="small" @click="fetchCapacity">Refresh</el-button>
            </div>
          </div>

          <el-table :data="capacity.tablespaces" :border="false" stripe size="small" empty-text="No data">
            <el-table-column prop="name" label="Tablespace" min-width="180" show-overflow-tooltip />
            <el-table-column prop="usedPercent" label="Used %" width="120" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ formatMaybePct(scope.row.usedPercent) }}</span></template>
            </el-table-column>
            <el-table-column prop="usedBytes" label="Used (GB)" width="130" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ formatGb(scope.row.usedBytes) }}</span></template>
            </el-table-column>
            <el-table-column prop="freeBytes" label="Free (GB)" width="130" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ formatGb(scope.row.freeBytes) }}</span></template>
            </el-table-column>
          </el-table>

          <div class="lm-section-head" style="margin-top: 16px;">
            <div class="lm-section-title">Fast Recovery Area (FRA)</div>
            <div class="lm-section-actions">
              <el-tag size="small" :type="fraTagType" effect="plain">{{ fraTagText }}</el-tag>
            </div>
          </div>

          <el-row :gutter="12">
            <el-col :span="6">
              <div class="info-item">
                <div class="info-label">Used %</div>
                <div class="info-value lm-num">{{ formatMaybePct(capacity.fra?.usedPercent ?? -1) }}</div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="info-item">
                <div class="info-label">Used (GB)</div>
                <div class="info-value lm-num">{{ formatGb(capacity.fra?.spaceUsed ?? -1) }}</div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="info-item">
                <div class="info-label">Limit (GB)</div>
                <div class="info-value lm-num">{{ formatGb(capacity.fra?.spaceLimit ?? -1) }}</div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="info-item">
                <div class="info-label">Reclaimable (GB)</div>
                <div class="info-value lm-num">{{ formatGb(capacity.fra?.spaceReclaimable ?? -1) }}</div>
              </div>
            </el-col>
          </el-row>
        </section>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useApi } from '../composables/useApi'

const props = defineProps({
  target: { type: Object, required: true },
  rangeParams: { type: Object, default: () => ({ range: '1h' }) },
  rangeText: { type: String, default: '' },
  isLive: { type: Boolean, default: true },
  autoRefresh: { type: Boolean, default: true }
})

const { getMetrics, getOracleLocks, getOracleCapacity } = useApi()

const chartAggs = reactive({})
const metricsData = ref([])
const latestPoint = ref({})
const activeTab = ref('metrics')
const locksData = ref([])
const capacity = ref({ tablespaces: [], fra: null })
const locksLoaded = ref(false)
const locksLoading = ref(false)
const capacityLoaded = ref(false)
const capacityLoading = ref(false)

let chartTimer = null
let chartInstances = {}
let chartsInFlight = false

const chartConfigs = [
  { id: 'oracle_chart_sessions', metric: 'sessions', title: 'Sessions', color: '#409EFF' },
  { id: 'oracle_chart_qps', metric: 'qps', title: 'QPS', color: '#67C23A' },
  { id: 'oracle_chart_active_sessions', metric: 'activeSessions', title: 'Active Sessions', color: '#8B5CF6' },
  { id: 'oracle_chart_lock_wait', metric: 'lockWaitSessions', title: 'Lock Wait Sessions', color: '#E6A23C' },
  { id: 'oracle_chart_ts_used', metric: 'tablespaceMaxUsed', title: 'Tablespace Max Used (%)', color: '#F56C6C' },
  { id: 'oracle_chart_fra_used', metric: 'fraUsed', title: 'FRA Used (%)', color: '#909399' }
]

const effectiveParams = computed(() => props.rangeParams || { range: '1h' })

const parseExtra = (m) => {
  try {
    const s = m?.extra_data
    if (!s) return {}
    if (typeof s === 'object') return s
    return JSON.parse(String(s))
  } catch {
    return {}
  }
}

const latestExtra = computed(() => parseExtra(latestPoint.value))

const formatNum = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n.toFixed(2)
}

const formatMaybeInt = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return '—'
  return String(Math.round(n))
}

const formatMaybePct = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `${n.toFixed(1)}%`
}

const formatGb = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  return (n / (1024 * 1024 * 1024)).toFixed(2)
}

const refreshMetrics = async () => {
  const rawData = await getMetrics(props.target.id, effectiveParams.value)
  metricsData.value = rawData || []
  latestPoint.value = (metricsData.value[metricsData.value.length - 1] || {})
}

const drawSingleChart = async (conf) => {
  const dom = document.getElementById(conf.id)
  if (!dom) return

  const rawData = metricsData.value || []

  const times = rawData.map(d => {
    const date = new Date(d.ts)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  })

  const values = rawData.map(d => {
    const v = conf.metric === 'activeSessions' ? parseExtra(d).activeSessions : d[conf.metric]
    if (v === null || v === undefined) return null
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    if ((conf.metric === 'lockWaitSessions' || conf.metric === 'tablespaceMaxUsed' || conf.metric === 'fraUsed') && n < 0) return null
    return n
  })

  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v))
  if (nums.length) {
    const sum = nums.reduce((a, b) => a + b, 0)
    chartAggs[conf.id] = { max: Math.max(...nums).toFixed(2), min: Math.min(...nums).toFixed(2), avg: (sum / nums.length).toFixed(2) }
  } else {
    chartAggs[conf.id] = { max: 0, min: 0, avg: 0 }
  }

  if (!chartInstances[conf.id]) chartInstances[conf.id] = echarts.init(dom)
  chartInstances[conf.id].setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: { left: '40', right: '20', top: '20', bottom: '35' },
    xAxis: { type: 'category', data: times, axisLabel: { color: '#999' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    dataZoom: [{ type: 'inside' }],
    series: [{
      data: values,
      type: 'line',
      smooth: true,
      showSymbol: false,
      sampling: 'lttb',
      itemStyle: { color: conf.color },
      areaStyle: { opacity: 0.1 }
    }]
  })
}

const connectCharts = () => {
  const instances = chartConfigs
    .map(c => chartInstances[c.id])
    .filter(i => i && !i.isDisposed())
  if (instances.length >= 2) echarts.connect(instances)
}

const initAllCharts = () => {
  if (chartsInFlight) return
  chartsInFlight = true
  nextTick(async () => {
    try {
      await refreshMetrics()
      await Promise.all(chartConfigs.map(drawSingleChart))
      connectCharts()
    } finally {
      chartsInFlight = false
    }
  })
}

const fetchLocksData = async () => {
  if (locksLoading.value) return
  locksLoading.value = true
  try {
    locksData.value = await getOracleLocks(props.target.id)
    locksLoaded.value = true
  } finally {
    locksLoading.value = false
  }
}

const fetchCapacity = async () => {
  if (capacityLoading.value) return
  capacityLoading.value = true
  try {
    capacity.value = await getOracleCapacity(props.target.id)
    capacityLoaded.value = true
  } finally {
    capacityLoading.value = false
  }
}

const lockWaitKpiNum = computed(() => {
  const n = Number(latestPoint.value.lockWaitSessions)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.max(0, Math.floor(n))
})
const lockWaitKpiText = computed(() => {
  const n = Number(latestPoint.value.lockWaitSessions)
  if (!Number.isFinite(n) || n < 0) return '—'
  return String(Math.max(0, Math.floor(n)))
})
const locksTabLabel = computed(() => `Locks (${lockWaitKpiText.value})`)
const capacityTagText = computed(() => {
  const ts = Number(latestPoint.value.tablespaceMaxUsed)
  const fra = Number(latestPoint.value.fraUsed)
  const parts = []
  if (Number.isFinite(ts) && ts >= 0) parts.push(`TS ${ts.toFixed(0)}%`)
  if (Number.isFinite(fra) && fra >= 0) parts.push(`FRA ${fra.toFixed(0)}%`)
  return parts.length ? parts.join(' / ') : '—'
})
const capacityWarn = computed(() => {
  const ts = Number(latestPoint.value.tablespaceMaxUsed)
  const fra = Number(latestPoint.value.fraUsed)
  return (Number.isFinite(ts) && ts >= 85) || (Number.isFinite(fra) && fra >= 85)
})
const fraTagType = computed(() => {
  const n = Number(capacity.value?.fra?.usedPercent)
  if (!Number.isFinite(n) || n < 0) return 'info'
  if (n >= 95) return 'danger'
  if (n >= 85) return 'warning'
  return 'success'
})
const fraTagText = computed(() => {
  const n = Number(capacity.value?.fra?.usedPercent)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `Used ${n.toFixed(1)}%`
})

watch(
  () => [props.autoRefresh, props.isLive, effectiveParams.value, activeTab.value],
  () => {
    clearInterval(chartTimer)
    if (activeTab.value !== 'metrics') return
    initAllCharts()
    if (props.autoRefresh && props.isLive) chartTimer = setInterval(initAllCharts, 5000)
  },
  { immediate: true }
)

watch(
  () => activeTab.value,
  async (tab) => {
    if (tab === 'locks' && !locksLoaded.value) await fetchLocksData()
    if (tab === 'capacity' && !capacityLoaded.value) await fetchCapacity()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearInterval(chartTimer)
  Object.values(chartInstances).forEach(i => {
    if (i && !i.isDisposed()) i.dispose()
  })
  chartInstances = {}
})
</script>

<style scoped>
.oracle-panel { display: flex; flex-direction: column; gap: 16px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.live-card :deep(.el-card__body) { padding: 16px 16px; }
.ops-strip { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ops-item { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: var(--lm-border); border-radius: 12px; padding: 8px 10px; box-shadow: var(--lm-shadow-sm); cursor: pointer; user-select: none; }
.ops-item:hover { border-color: #cbd5e1; }
.ops-label { font-size: 12px; color: #475569; font-weight: 700; }
.ops-hint { margin-left: auto; font-size: 12px; color: var(--lm-muted); }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-card { background: #fff; border-radius: 12px; padding: 14px 14px; border: var(--lm-border); box-shadow: var(--lm-shadow-sm); }
.chart-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 10px; }
.chart-title { font-weight: 700; color: #303133; font-size: 13px; }
.chart-agg { font-size: 12px; color: #606266; display: inline-flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; text-align: right; }
.chart-canvas { width: 100%; height: 280px; }
.info-item { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: var(--lm-shadow-sm); border: var(--lm-border); }
.info-label { font-size: 11px; color: var(--lm-muted); letter-spacing: 0.02em; }
.info-value { margin-top: 6px; font-size: 16px; font-weight: 700; color: var(--lm-text); }
.lm-section { background: #fff; border: var(--lm-border); border-radius: 12px; box-shadow: var(--lm-shadow-sm); padding: 14px 14px; }
.lm-section-danger { border-color: #fecaca; }
.lm-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.lm-section-title { font-size: 14px; font-weight: 800; color: #111827; }
.lm-section-actions { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.hint-strip { margin-top: 10px; font-size: 12px; color: var(--lm-muted); }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}
</style>
