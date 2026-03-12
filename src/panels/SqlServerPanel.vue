<template>
  <div class="mssql-panel">
    <div class="ops-strip">
      <div class="ops-item" role="button" tabindex="0" @click="activeTab = 'blocking'">
        <div class="ops-label">Blocking</div>
        <el-tag size="small" :type="blockingCount ? 'danger' : 'info'" effect="plain">{{ blockingCount }}</el-tag>
      </div>
      <div class="ops-hint">{{ rangeText }}</div>
    </div>

    <el-card shadow="never" class="kpi-card-root">
      <template #header>
        <div class="panel-header">
          <b>KPI (Latest Snapshot)</b>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Response (ms) · Latest</div>
            <div class="info-value lm-num">{{ respMsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Batch Requests (/s) · Latest</div>
            <div class="info-value lm-num">{{ qpsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">User Connections · Latest</div>
            <div class="info-value lm-num">{{ sessionsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Running Requests · Latest</div>
            <div class="info-value lm-num">{{ threadsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Blocking Sessions · Latest</div>
            <div class="info-value lm-num">{{ blockingCount }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Top Wait · Latest</div>
            <div class="info-value lm-num">{{ topWaitText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Disk Read Latency (ms) · Latest</div>
            <div class="info-value lm-num">{{ ioReadText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">AG Sync Lag · Latest</div>
            <div class="info-value lm-num">{{ agLagText }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-tabs v-model="activeTab" class="mssql-tabs">
      <el-tab-pane label="Metrics" name="metrics">
        <section class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title">Metrics Trend</div>
          </div>

          <div class="charts-grid">
            <div class="chart-card" v-for="conf in chartConfigs" :key="conf.id">
              <div class="chart-head">
                <div class="chart-title">{{ conf.title }}</div>
                <div class="chart-agg">
                  <template v-if="conf.kind === 'single'">
                    <span>Max <b class="lm-num">{{ chartAggs[conf.id]?.max || 0 }}</b></span>
                    <span>Min <b class="lm-num">{{ chartAggs[conf.id]?.min || 0 }}</b></span>
                    <span>Avg <b class="lm-num">{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
                  </template>
                  <template v-else-if="conf.kind === 'waits'">
                    <span>Top <b class="lm-num">{{ topWaitText }}</b></span>
                  </template>
                  <template v-else-if="conf.kind === 'io'">
                    <span>Read <b class="lm-num">{{ ioReadText }}</b> ms</span>
                    <span>Write <b class="lm-num">{{ ioWriteText }}</b> ms</span>
                  </template>
                  <template v-else-if="conf.kind === 'ag'">
                    <span>Latest <b class="lm-num">{{ agLagText }}</b></span>
                  </template>
                </div>
              </div>

              <div v-if="conf.kind === 'ag' && roleValue !== 'slave'" class="chart-empty">
                <div class="chart-empty-title">N/A</div>
                <div class="chart-empty-sub">AG Sync Lag is only available on secondary.</div>
              </div>
              <div v-else :id="conf.id" class="chart-canvas"></div>
            </div>
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane :label="blockingTabLabel" name="blocking">
        <section class="lm-section lm-section-danger">
          <div class="lm-section-head">
            <div class="lm-section-title">Blocking Monitor</div>
            <div class="lm-section-actions">
              <el-button size="small" type="danger" plain @click="refreshBlocking">Refresh</el-button>
            </div>
          </div>

          <el-table :data="blockingData" :border="false" stripe size="small" empty-text="No blocking">
            <el-table-column prop="spid" label="SPID" width="90" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.spid }}</span></template>
            </el-table-column>
            <el-table-column prop="blockedBy" label="Blocked By" width="110" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.blockedBy }}</span></template>
            </el-table-column>
            <el-table-column prop="waitSeconds" label="Wait (s)" width="110" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.waitSeconds }}</span></template>
            </el-table-column>
            <el-table-column prop="waitType" label="Wait Type" width="140" show-overflow-tooltip />
            <el-table-column prop="database" label="DB" width="140" show-overflow-tooltip />
            <el-table-column prop="resource" label="Resource" min-width="160" show-overflow-tooltip />
            <el-table-column prop="sql" label="SQL" min-width="320" show-overflow-tooltip />
          </el-table>
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

const { getMetrics, getMssqlBlocking } = useApi()

const chartAggs = reactive({})
const metricsData = ref([])
const latestPoint = ref({})
const activeTab = ref('metrics')
const blockingData = ref([])

let chartTimer = null
let chartInstances = {}
let chartsInFlight = false

const chartConfigs = [
  { id: 'mssql_chart_qps', kind: 'single', title: 'Batch Requests (/s)', color: '#2563eb', metric: 'qps' },
  { id: 'mssql_chart_sessions', kind: 'single', title: 'User Connections', color: '#7c3aed', metric: 'sessions' },
  { id: 'mssql_chart_waits', kind: 'waits', title: 'Top Waits (category)' },
  { id: 'mssql_chart_io', kind: 'io', title: 'Disk Latency (Read/Write)' },
  { id: 'mssql_chart_ag', kind: 'ag', title: 'AG Sync Lag (Secondary)' }
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

const roleValue = computed(() => {
  const lr = String(latestPoint.value.role || '').toLowerCase()
  if (lr && lr !== 'unknown') return lr
  return String(props.target.repl_role || '').toLowerCase()
})

const blockingCount = computed(() => {
  const n = Number(latestExtra.value.blockingSessions)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
})

const blockingTabLabel = computed(() => `Blocking (${blockingCount.value})`)

const topWaitText = computed(() => {
  const cat = String(latestExtra.value.topWaitCategory || '').toUpperCase()
  const pct = Number(latestExtra.value.topWaitPct)
  if (!cat) return '—'
  if (!Number.isFinite(pct) || pct <= 0) return cat
  return `${cat} ${pct.toFixed(0)}%`
})

const ioReadText = computed(() => {
  const n = Number(latestExtra.value.diskReadLatencyMs)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
})

const ioWriteText = computed(() => {
  const n = Number(latestExtra.value.diskWriteLatencyMs)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(1)
})

const agLagText = computed(() => {
  if (roleValue.value !== 'slave') return '—'
  const n = Number(latestExtra.value.agSyncLagSec)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `${Math.round(n)}s`
})

const respMsText = computed(() => {
  const n = Number(latestPoint.value.resp_time)
  if (!Number.isFinite(n) || n < 0) return '—'
  return String(Math.round(n))
})

const qpsText = computed(() => {
  const n = Number(latestPoint.value.qps)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
})

const sessionsText = computed(() => {
  const n = Number(latestPoint.value.sessions)
  if (!Number.isFinite(n)) return '—'
  return String(Math.max(0, Math.floor(n)))
})

const threadsText = computed(() => {
  const n = Number(latestPoint.value.threadsRunning)
  if (!Number.isFinite(n)) return '—'
  return String(Math.max(0, Math.floor(n)))
})

const refreshMetrics = async () => {
  const rawData = await getMetrics(props.target.id, { ...effectiveParams.value, maxPoints: 720 })
  metricsData.value = rawData || []
  latestPoint.value = (metricsData.value[metricsData.value.length - 1] || {})
}

const toTimes = (rawData) => rawData.map(d => {
  const date = new Date(d.ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
})

const safeNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const drawSingleLineChart = (dom, conf, times, values) => {
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
    grid: { left: '44', right: '18', top: '20', bottom: '35' },
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

const drawWaitsChart = (dom, conf, times, rawData) => {
  const cats = ['LOCK', 'IO', 'CPU', 'LOG', 'TEMPDB', 'OTHER']
  const series = cats.map((c) => {
    const values = rawData.map(d => {
      const ex = parseExtra(d)
      const p = ex?.waitsPct?.[c]
      return safeNum(p)
    })
    return {
      name: c,
      type: 'line',
      stack: 'pct',
      smooth: true,
      showSymbol: false,
      sampling: 'lttb',
      areaStyle: { opacity: 0.12 },
      data: values
    }
  })
  if (!chartInstances[conf.id]) chartInstances[conf.id] = echarts.init(dom)
  chartInstances[conf.id].setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, valueFormatter: (v) => `${v}%` },
    grid: { left: '44', right: '18', top: '20', bottom: '35' },
    xAxis: { type: 'category', data: times, axisLabel: { color: '#999' } },
    yAxis: { type: 'value', max: 100, min: 0, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    dataZoom: [{ type: 'inside' }],
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 11 } },
    series
  })
}

const drawIoChart = (dom, conf, times, rawData) => {
  const read = rawData.map(d => safeNum(parseExtra(d)?.diskReadLatencyMs))
  const write = rawData.map(d => safeNum(parseExtra(d)?.diskWriteLatencyMs))
  if (!chartInstances[conf.id]) chartInstances[conf.id] = echarts.init(dom)
  chartInstances[conf.id].setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: { left: '44', right: '18', top: '20', bottom: '35' },
    xAxis: { type: 'category', data: times, axisLabel: { color: '#999' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    dataZoom: [{ type: 'inside' }],
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 11 } },
    series: [
      { name: 'Read', data: read, type: 'line', smooth: true, showSymbol: false, sampling: 'lttb', itemStyle: { color: '#2563eb' }, areaStyle: { opacity: 0.08 } },
      { name: 'Write', data: write, type: 'line', smooth: true, showSymbol: false, sampling: 'lttb', itemStyle: { color: '#7c3aed' }, areaStyle: { opacity: 0.08 } }
    ]
  })
}

const drawAgChart = (dom, conf, times, rawData) => {
  const values = rawData.map(d => safeNum(parseExtra(d)?.agSyncLagSec))
  if (!chartInstances[conf.id]) chartInstances[conf.id] = echarts.init(dom)
  chartInstances[conf.id].setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, valueFormatter: (v) => `${v}s` },
    grid: { left: '44', right: '18', top: '20', bottom: '35' },
    xAxis: { type: 'category', data: times, axisLabel: { color: '#999' } },
    yAxis: { type: 'value', min: 0, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    dataZoom: [{ type: 'inside' }],
    series: [{
      data: values,
      type: 'line',
      smooth: true,
      showSymbol: false,
      sampling: 'lttb',
      itemStyle: { color: '#dc2626' },
      areaStyle: { opacity: 0.1 }
    }]
  })
}

const drawSingleChart = async (conf) => {
  const dom = document.getElementById(conf.id)
  if (!dom) {
    const inst = chartInstances[conf.id]
    if (inst && !inst.isDisposed()) inst.dispose()
    delete chartInstances[conf.id]
    return
  }
  const rawData = metricsData.value || []
  const times = toTimes(rawData)
  if (conf.kind === 'single') {
    const values = rawData.map(d => safeNum(d?.[conf.metric]))
    drawSingleLineChart(dom, conf, times, values)
    return
  }
  if (conf.kind === 'waits') {
    drawWaitsChart(dom, conf, times, rawData)
    return
  }
  if (conf.kind === 'io') {
    drawIoChart(dom, conf, times, rawData)
    return
  }
  if (conf.kind === 'ag') {
    drawAgChart(dom, conf, times, rawData)
  }
}

const connectCharts = () => {
  const instances = chartConfigs
    .map(c => chartInstances[c.id])
    .filter(i => i && !i.isDisposed())
  if (instances.length >= 2) echarts.connect(instances)
}

const refreshBlocking = async () => {
  const rows = await getMssqlBlocking(props.target.id)
  blockingData.value = rows || []
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

watch(
  () => [props.autoRefresh, props.isLive, effectiveParams.value, activeTab.value],
  () => {
    clearInterval(chartTimer)
    if (activeTab.value === 'metrics') {
      initAllCharts()
      if (props.autoRefresh && props.isLive) chartTimer = setInterval(initAllCharts, 5000)
      return
    }
    if (activeTab.value === 'blocking') {
      refreshBlocking()
      if (props.autoRefresh && props.isLive) chartTimer = setInterval(refreshBlocking, 5000)
    }
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
.ops-strip { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ops-item { display: inline-flex; align-items: center; gap: 8px; background: #fff; border-radius: 12px; border: var(--lm-border); box-shadow: var(--lm-shadow-sm); padding: 10px 12px; cursor: pointer; }
.ops-label { font-size: 12px; color: var(--lm-text); font-weight: 700; }
.ops-hint { margin-left: auto; font-size: 12px; color: var(--lm-muted); }
.kpi-card-root { border-radius: 12px; border: var(--lm-border); box-shadow: var(--lm-shadow-sm); }
.kpi-card-root :deep(.el-card__body) { padding: 16px 16px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.info-item { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: var(--lm-shadow-sm); border: var(--lm-border); }
.info-label { font-size: 11px; color: var(--lm-muted); letter-spacing: 0.02em; }
.info-value { margin-top: 6px; font-size: 16px; font-weight: 700; color: var(--lm-text); text-align: right; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-card { background: #fff; border-radius: 12px; border: var(--lm-border); box-shadow: var(--lm-shadow-sm); padding: 14px 14px; min-height: 320px; }
.chart-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.chart-title { font-size: 13px; font-weight: 800; color: var(--lm-text); }
.chart-agg { display: inline-flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--lm-muted); justify-content: flex-end; text-align: right; }
.chart-agg b { color: var(--lm-text); font-weight: 900; }
.chart-canvas { width: 100%; height: 260px; }
.chart-empty { height: 260px; border-radius: 10px; border: 1px dashed #cbd5e1; background: #f8fafc; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px; }
.chart-empty-title { font-weight: 900; color: #111827; }
.chart-empty-sub { font-size: 12px; color: #6b7280; }
.lm-section { background: #fff; border: var(--lm-border); border-radius: 12px; box-shadow: var(--lm-shadow-sm); padding: 14px 14px; }
.lm-section-danger { border-color: #fecaca; }
.lm-section-danger .lm-section-title { color: #b91c1c; }
.lm-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.lm-section-title { font-size: 14px; font-weight: 900; }
.lm-section-actions { display: inline-flex; align-items: center; gap: 8px; }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}
</style>

