<template>
  <div class="mysql-panel">
    <div class="ops-strip">
      <div class="ops-item" role="button" tabindex="0" @click="activeTab = 'locks'">
        <div class="ops-label">Lock waits</div>
        <el-tag size="small" :type="lockCountNum ? 'danger' : 'info'" effect="plain">{{ lockCountText }}</el-tag>
      </div>
      <div class="ops-item" role="button" tabindex="0" @click="activeTab = 'slow'">
        <div class="ops-label">Slow queries</div>
        <el-tag size="small" type="warning" effect="plain">{{ slowCount }}</el-tag>
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
            <div class="info-label">QPS · Latest</div>
            <div class="info-value lm-num">{{ qpsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">TPS · Latest</div>
            <div class="info-value lm-num">{{ tpsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Connections · Latest</div>
            <div class="info-value lm-num">{{ sessionsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Threads Running · Latest</div>
            <div class="info-value lm-num">{{ threadsText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Slow Count · Latest</div>
            <div class="info-value lm-num">{{ slowCount }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Replication Lag · Latest</div>
            <div class="info-value lm-num">{{ lagText }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Role · Latest</div>
            <div class="info-value lm-num">{{ roleLabel }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-tabs v-model="activeTab" class="mysql-tabs">
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
                  <span>Max <b class="lm-num">{{ chartAggs[conf.id]?.max || 0 }}</b></span>
                  <span>Min <b class="lm-num">{{ chartAggs[conf.id]?.min || 0 }}</b></span>
                  <span>Avg <b class="lm-num">{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
                </div>
              </div>

              <div v-if="conf.metric === 'slaveDelay' && roleValue !== 'slave'" class="chart-empty">
                <div class="chart-empty-title">N/A</div>
                <div class="chart-empty-sub">Seconds Behind Master is only available on slave.</div>
              </div>
              <div v-else :id="conf.id" class="chart-canvas"></div>
            </div>
          </div>
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

          <el-table :data="lockData" :border="false" stripe size="small" empty-text="No lock waits">
            <el-table-column prop="blocking_thread" label="Blocking" width="110" />
            <el-table-column prop="waiting_thread" label="Waiting" width="110" />
            <el-table-column prop="lock_duration" label="Duration (s)" width="120" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.lock_duration }}</span></template>
            </el-table-column>
            <el-table-column label="Actions" width="90">
              <template #default="scope">
                <el-button type="danger" size="small" @click="handleKill(scope.row.blocking_thread)">KILL</el-button>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </el-tab-pane>

      <el-tab-pane :label="slowTabLabel" name="slow">
        <section class="lm-section">
          <div class="lm-section-head">
            <div class="lm-section-title">Top Slow Queries</div>
            <div class="lm-section-actions">
              <el-button size="small" @click="refreshSlow">Refresh</el-button>
              <el-button size="small" type="primary" plain @click="showSlowDetails">Open</el-button>
            </div>
          </div>

          <el-table :data="slowData" :border="false" stripe size="small" empty-text="No data">
            <el-table-column prop="exec_count" label="Count" width="100" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.exec_count }}</span></template>
            </el-table-column>
            <el-table-column prop="max_time" label="Avg Latency (ms)" width="160" align="right" header-align="right">
              <template #default="scope"><span class="lm-num">{{ scope.row.max_time }}</span></template>
            </el-table-column>
            <el-table-column prop="sql_text" label="SQL" min-width="360" show-overflow-tooltip />
          </el-table>
        </section>
      </el-tab-pane>
    </el-tabs>

    <SlowQueryModal v-model:visible="slowDialogVisible" :data="slowData" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useApi } from '../composables/useApi'
import SlowQueryModal from '../components/SlowQueryModal.vue'

const props = defineProps({
  target: { type: Object, required: true },
  rangeParams: { type: Object, default: () => ({ range: '1h' }) },
  rangeText: { type: String, default: '' },
  isLive: { type: Boolean, default: true },
  autoRefresh: { type: Boolean, default: true }
})

const { getLocks, killSession, getTopSlow, getMetrics } = useApi()

const lockData = ref([])
const slowData = ref([])
const slowDialogVisible = ref(false)
const activeTab = ref('metrics')

const locksLoaded = ref(false)
const locksLoading = ref(false)
const slowLoaded = ref(false)
const slowLoading = ref(false)

const chartAggs = reactive({})
let chartTimer = null
let chartInstances = {}
let chartsInFlight = false

const chartConfigs = [
  { id: 'mysql_chart_conn', metric: 'sessions', title: 'Connections', color: '#409EFF' },
  { id: 'mysql_chart_qps', metric: 'qps', title: 'QPS', color: '#67C23A' },
  { id: 'mysql_chart_tps', metric: 'tps', title: 'TPS', color: '#E6A23C' },
  { id: 'mysql_chart_delay', metric: 'slaveDelay', title: 'Seconds_Behind_Master (s)', color: '#F56C6C' }
]

const effectiveParams = computed(() => props.rangeParams || { range: '1h' })
const latest = computed(() => props.target?.latest || {})
const roleValue = computed(() => {
  const lr = String(latest.value.role || '').toLowerCase()
  if (lr && lr !== 'unknown') return lr
  return String(props.target?.repl_role || '').toLowerCase()
})
const lockCountNum = computed(() => (lockData.value || []).length)
const lockCountText = computed(() => (locksLoaded.value ? String(lockCountNum.value) : '—'))
const roleLabel = computed(() => (roleValue.value === 'slave' ? 'Slave' : roleValue.value === 'master' ? 'Master' : roleValue.value === 'standalone' ? 'Standalone' : 'Unknown'))
const slowCount = computed(() => {
  const n = Number(latest.value.slowCount)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
})
const locksTabLabel = computed(() => `Locks (${locksLoaded.value ? lockCountNum.value : '—'})`)
const slowTabLabel = computed(() => `Slow Queries (${slowCount.value})`)

const respMsText = computed(() => {
  const n = Number(latest.value.resp_time)
  if (!Number.isFinite(n) || n < 0) return '—'
  return String(Math.round(n))
})
const qpsText = computed(() => {
  const n = Number(latest.value.qps)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
})
const tpsText = computed(() => {
  const n = Number(latest.value.tps)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
})
const sessionsText = computed(() => {
  const n = Number(latest.value.sessions)
  if (!Number.isFinite(n)) return '—'
  return String(Math.max(0, Math.floor(n)))
})
const threadsText = computed(() => {
  const n = Number(latest.value.threadsRunning)
  if (!Number.isFinite(n)) return '—'
  return String(Math.max(0, Math.floor(n)))
})
const lagText = computed(() => {
  if (roleValue.value !== 'slave') return '—'
  const n = Number(latest.value.slaveDelay)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `${Math.round(n)}s`
})

const drawSingleChart = async (conf, rawData) => {
  const dom = document.getElementById(conf.id)
  if (!dom) return

  const times = rawData.map(d => {
    const date = new Date(d.ts)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  })

  const values = rawData.map(d => {
    const v = d[conf.metric]
    if (conf.metric === 'slaveDelay') {
      if (v === null || v === undefined) return null
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : null
    }
    return (v === null || v === undefined) ? 0 : Number(v)
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
      const rawData = await getMetrics(props.target.id, { ...effectiveParams.value, maxPoints: 720 })
      await Promise.all(chartConfigs.map(async (c) => {
        if (c.metric === 'slaveDelay' && roleValue.value !== 'slave') return
        await drawSingleChart(c, rawData)
      }))
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
    lockData.value = await getLocks(props.target.id)
    locksLoaded.value = true
  } finally {
    locksLoading.value = false
  }
}

const handleKill = async (threadId) => {
  const success = await killSession(props.target.id, threadId)
  if (success) fetchLocksData()
}

const showSlowDetails = async () => {
  if (slowLoading.value) return
  slowLoading.value = true
  try {
    slowData.value = await getTopSlow(props.target.id)
    slowLoaded.value = true
    slowDialogVisible.value = true
  } finally {
    slowLoading.value = false
  }
}

const refreshSlow = async () => {
  if (slowLoading.value) return
  slowLoading.value = true
  try {
    slowData.value = await getTopSlow(props.target.id)
    slowLoaded.value = true
  } finally {
    slowLoading.value = false
  }
}

watch(
  () => [props.autoRefresh, props.isLive, effectiveParams.value, activeTab.value, roleValue.value],
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
    if (tab === 'slow' && !slowLoaded.value) await refreshSlow()
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
.mysql-panel { display: flex; flex-direction: column; gap: 16px; }
.ops-strip { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ops-item { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: var(--lm-border); border-radius: 12px; padding: 8px 10px; box-shadow: var(--lm-shadow-sm); cursor: pointer; user-select: none; }
.ops-item:hover { border-color: #cbd5e1; }
.ops-label { font-size: 12px; color: var(--lm-muted); }
.ops-hint { margin-left: auto; font-size: 12px; color: var(--lm-muted); }
.kpi-card-root :deep(.el-card__body) { padding: 16px 16px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.info-item { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: var(--lm-shadow-sm); border: var(--lm-border); }
.info-label { font-size: 11px; color: var(--lm-muted); letter-spacing: 0.02em; }
.info-value { margin-top: 6px; font-size: 16px; font-weight: 700; color: var(--lm-text); text-align: right; }
.mysql-tabs :deep(.el-tabs__header) { margin: 0; }
.mysql-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
.mysql-tabs :deep(.el-tabs__item) { height: 34px; line-height: 34px; font-size: 13px; }
.lm-section { background: #fff; border: var(--lm-border); border-radius: 12px; box-shadow: var(--lm-shadow-sm); padding: 14px 14px; }
.lm-section-danger { border-color: #fecaca; }
.lm-section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.lm-section-title { font-size: 14px; font-weight: 800; color: var(--lm-text); }
.lm-section-actions { display: inline-flex; align-items: center; gap: 8px; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.chart-card { background: #fff; border: var(--lm-border); border-radius: 12px; padding: 12px 12px; }
.chart-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.chart-title { font-size: 13px; font-weight: 800; color: var(--lm-text); }
.chart-agg { display: inline-flex; gap: 10px; font-size: 12px; color: var(--lm-muted); flex-wrap: wrap; justify-content: flex-end; text-align: right; }
.chart-agg b { color: var(--lm-text); font-weight: 800; }
.chart-canvas { width: 100%; height: 260px; }
.chart-empty { height: 260px; border-radius: 10px; background: #f8fafc; border: 1px dashed #cbd5e1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.chart-empty-title { font-size: 14px; font-weight: 900; color: #334155; }
.chart-empty-sub { font-size: 12px; color: #64748b; }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
  .ops-hint { width: 100%; margin-left: 0; }
}
</style>

