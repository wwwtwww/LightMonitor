<template>
  <div>
    <el-card class="box-card" shadow="never" style="margin-bottom: 20px;">
      <template #header>
        <div class="panel-header">
          <b>MySQL Metrics Trend</b>
          <el-button size="small" type="primary" plain @click="showSlowDetails">Top Slow Queries</el-button>
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

    <el-card shadow="never" style="margin-top: 20px; border-color: #F56C6C;">
      <template #header>
        <div style="display:flex; justify-content:space-between">
          <b style="color: #F56C6C;">Lock Wait Monitor</b>
          <el-button size="small" type="danger" plain @click="fetchLocksData">Refresh</el-button>
        </div>
      </template>
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
    </el-card>

    <SlowQueryModal v-model:visible="slowDialogVisible" :data="slowData" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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

const drawSingleChart = async (conf) => {
  const dom = document.getElementById(conf.id)
  if (!dom) return

  const rawData = await getMetrics(props.target.id, effectiveParams.value)

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
    await Promise.all(chartConfigs.map(drawSingleChart))
    connectCharts()
    chartsInFlight = false
  })
}

const fetchLocksData = async () => {
  lockData.value = await getLocks(props.target.id)
}

const handleKill = async (threadId) => {
  const success = await killSession(props.target.id, threadId)
  if (success) fetchLocksData()
}

const showSlowDetails = async () => {
  slowData.value = await getTopSlow(props.target.id)
  slowDialogVisible.value = true
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

onMounted(() => {
  fetchLocksData()
})

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
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}
</style>

