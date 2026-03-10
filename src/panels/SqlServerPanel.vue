<template>
  <div>
    <el-card shadow="never" style="margin-bottom: 20px;">
      <template #header>
        <div class="panel-header">
          <b>MSSQL Live Metrics</b>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">QPS (Batch Requests)</div>
            <div class="info-value">{{ formatNum(latestPoint.qps) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">PLE (s)</div>
            <div class="info-value">{{ latestExtra.ple ?? 0 }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Compilations/s</div>
            <div class="info-value">{{ formatNum(latestExtra.compilationsPerSec) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="info-item">
            <div class="info-label">Active Connections</div>
            <div class="info-value">{{ latestPoint.sessions ?? 0 }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="box-card" shadow="never">
      <template #header>
        <div class="panel-header">
          <b>MSSQL Metrics Trend</b>
        </div>
      </template>
      <div class="charts-grid">
        <div class="chart-item" v-for="conf in chartConfigs" :key="conf.id">
          <div class="chart-header">
            <span class="title">{{ conf.title }} ({{ rangeText }})</span>
            <div class="agg-stats">
              <span>Max: <b>{{ chartAggs[conf.id]?.max || 0 }}</b></span>
              <span>Min: <b>{{ chartAggs[conf.id]?.min || 0 }}</b></span>
              <span>Avg: <b>{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
            </div>
          </div>
          <div :id="conf.id" style="width: 100%; height: 280px;"></div>
        </div>
      </div>
    </el-card>
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

const { getMetrics } = useApi()

const chartAggs = reactive({})
const metricsData = ref([])
const latestPoint = ref({})

let chartTimer = null
let chartInstances = {}
let chartsInFlight = false

const chartConfigs = [
  { id: 'mssql_chart_conn', metric: 'sessions', title: 'Connections', color: '#409EFF' },
  { id: 'mssql_chart_qps', metric: 'qps', title: 'Batch Requests (QPS)', color: '#67C23A' }
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
    const v = d[conf.metric]
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
    await refreshMetrics()
    await Promise.all(chartConfigs.map(drawSingleChart))
    connectCharts()
    chartsInFlight = false
  })
}

watch(
  () => [props.autoRefresh, props.isLive, effectiveParams.value],
  () => {
    clearInterval(chartTimer)
    initAllCharts()
    if (props.autoRefresh && props.isLive) chartTimer = setInterval(initAllCharts, 5000)
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
.panel-header { display: flex; align-items: center; justify-content: space-between; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-item { background: #fff; padding: 20px; border-radius: 8px; box-shadow: var(--lm-shadow-md); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.chart-header .title { font-weight: bold; color: #303133; }
.agg-stats { font-size: 12px; color: #606266; }
.agg-stats span { margin-left: 15px; }
.agg-stats b { color: #303133; }
.info-item { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: var(--lm-shadow-sm); border: var(--lm-border); }
.info-label { font-size: 11px; color: var(--lm-muted); letter-spacing: 0.02em; }
.info-value { margin-top: 6px; font-size: 16px; font-weight: 700; color: var(--lm-text); }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}
</style>

