<template>
  <div class="detail-view">
    <div class="control-bar">
      <div class="control-left">
        <el-button @click="emit('back')" icon="ArrowLeft">返回列表</el-button>
        <h2 class="page-title">{{ target.name }}</h2>
      </div>

      <div class="control-right">
        <el-radio-group v-model="timeRange" size="default" @change="handleRangeChange">
          <el-radio-button label="1">近1h</el-radio-button>
          <el-radio-button label="3">近3h</el-radio-button>
          <el-radio-button label="6">近6h</el-radio-button>
          <el-radio-button label="24">近24h</el-radio-button>
        </el-radio-group>

        <el-date-picker
          v-model="customRange"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DD HH:mm:ss"
          :disabled-date="d => d.getTime() > Date.now()"
          @change="handleCustomRangeChange"
          size="default"
          style="width: 340px;"
        />

        <div class="auto-refresh">
          <span class="auto-refresh-label">自动刷新</span>
          <el-switch v-model="autoRefresh" @change="handleAutoRefreshChange" />
        </div>
      </div>
    </div>

    <el-card class="box-card" shadow="never" style="margin-bottom: 20px;">
      <template #header><b>监控概览</b></template>
      <div class="overview-grid">
        <div class="overview-card">
          <div class="overview-label">DB TYPE</div>
          <div class="overview-value">{{ (target.type || '').toUpperCase() }}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">ROLE</div>
          <div class="overview-value">{{ roleText }}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">HOST</div>
          <div class="overview-value">{{ target.host }}:{{ target.port }}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">USER</div>
          <div class="overview-value">{{ target.user }}</div>
        </div>

        <div class="overview-card">
          <div class="overview-label">SESSIONS</div>
          <div class="overview-value">{{ latestStats.sessions || 0 }}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">THREADS</div>
          <div class="overview-value">{{ latestStats.threadsRunning || 0 }}</div>
        </div>

        <div class="overview-card" v-if="target.type.toLowerCase() === 'mysql'">
          <div class="overview-label">QPS</div>
          <div class="overview-value">{{ latestStats.qps || 0 }}</div>
        </div>
        <div class="overview-card" v-if="target.type.toLowerCase() === 'mysql'">
          <div class="overview-label">TPS</div>
          <div class="overview-value">{{ latestStats.tps || 0 }}</div>
        </div>

        <div class="overview-card clickable" v-if="target.type.toLowerCase() === 'mysql'" @click="showSlowDetails">
          <div class="overview-label">SLOW QUERY</div>
          <div class="overview-value">{{ latestStats.slowCount || 0 }}</div>
        </div>

        <div class="overview-card" v-if="target.type.toLowerCase() === 'mysql' && isSlaveTarget()">
          <div class="overview-label">DELAY</div>
          <div class="overview-value">{{ latestStats.slaveDelay >= 0 ? latestStats.slaveDelay + 's' : '--' }}</div>
        </div>
      </div>
    </el-card>

    <!-- 实时锁表监测 -->
    <el-card v-if="target.type.toLowerCase() === 'mysql'" shadow="never" style="margin-bottom: 20px; border-color: #F56C6C;">
        <template #header><div style="display:flex; justify-content:space-between"><b style="color: #F56C6C;">🔒 实时锁表监测</b><el-button size="small" type="danger" plain @click="fetchLocksData">刷新锁</el-button></div></template>
        <el-table :data="lockData" border stripe size="small">
          <el-table-column prop="blocking_thread" label="源头" width="100" />
          <el-table-column prop="waiting_thread" label="被堵" width="100" />
          <el-table-column prop="lock_duration" label="时长(s)" width="100" />
          <el-table-column label="操作" width="80"><template #default="scope"><el-button type="danger" size="small" @click="handleKill(scope.row.blocking_thread)">KILL</el-button></template></el-table-column>
        </el-table>
    </el-card>

    <!-- 图表列表 -->
    <div class="charts-grid">
      <div class="chart-item" v-for="conf in chartConfigs" :key="conf.id" v-show="!conf.onlyMysql || target.type.toLowerCase() === 'mysql'">
        <div class="chart-header">
          <span class="title">📈 {{ conf.title }} ({{ getRangeText() }})</span>
          <div class="agg-stats">
            <span>最大: <b>{{ chartAggs[conf.id]?.max || 0 }}</b></span>
            <span>最小: <b>{{ chartAggs[conf.id]?.min || 0 }}</b></span>
            <span>平均: <b>{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
          </div>
        </div>
        <div :id="conf.id" style="width: 100%; height: 280px;"></div>
      </div>
    </div>

    <SlowQueryModal v-model:visible="slowDialogVisible" :data="slowData" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick, defineProps, defineEmits, onBeforeUnmount, computed } from 'vue'
import * as echarts from 'echarts'
import { View, ArrowLeft } from '@element-plus/icons-vue'
import { useApi } from '../composables/useApi'
import SlowQueryModal from './SlowQueryModal.vue'

const props = defineProps({
  target: Object
})
const emit = defineEmits(['back'])

const { getLocks, killSession, getTopSlow, getMetrics } = useApi()

const timeRange = ref("1")
const customRange = ref([])
const autoRefresh = ref(true)
const latestStats = ref(props.target.latest || {})
const lockData = ref([])
const slowData = ref([])
const slowDialogVisible = ref(false)
const chartAggs = reactive({})

let chartTimer = null
let chartInstances = {}
let chartsInFlight = false

const chartConfigs = [
  { id: 'chart_conn', metric: 'sessions', title: '连接数趋势', color: '#409EFF' },
  { id: 'chart_qps', metric: 'qps', title: 'QPS 趋势', color: '#67C23A', onlyMysql: true },
  { id: 'chart_tps', metric: 'tps', title: 'TPS 趋势', color: '#E6A23C', onlyMysql: true },
  { id: 'chart_delay', metric: 'slaveDelay', title: 'Seconds_Behind_Master(s)', color: '#F56C6C', onlyMysql: true }
]

const isSlaveTarget = () => ((latestStats.value.role || props.target.repl_role || '').toLowerCase() === 'slave')
const roleText = computed(() => {
  const role = ((latestStats.value.role || props.target.repl_role || 'standalone') + '').toLowerCase()
  if (role === 'slave') return '从库'
  if (role === 'master') return '主库'
  if (role === 'standalone') return '单机'
  return '未知'
})
const getRangeText = () => {
  if (customRange.value && customRange.value.length === 2) return `${customRange.value[0]} ~ ${customRange.value[1]}`
  return `近${timeRange.value}h`
}

const drawSingleChart = async (conf) => {
  const dom = document.getElementById(conf.id)
  if (!dom) return
  
  let params = { range: `${timeRange.value}h` }
  if (customRange.value && customRange.value.length === 2) {
    params = {
      from: new Date(customRange.value[0]).getTime(),
      to: new Date(customRange.value[1]).getTime()
    }
  }
  
  const rawData = await getMetrics(props.target.id, params)
  
  // Update latest stats if it's the latest point and we are in live mode
  if (rawData.length > 0 && (!customRange.value || customRange.value.length === 0)) {
    latestStats.value = rawData[rawData.length - 1]
  }

  const times = rawData.map(d => {
    const date = new Date(d.ts)
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`
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
    const isMysql = props.target.type.toLowerCase() === 'mysql'
    const confs = chartConfigs.filter(conf => !conf.onlyMysql || isMysql)
    await Promise.all(confs.map(drawSingleChart))
    connectCharts()
    chartsInFlight = false
  })
}

const handleRangeChange = () => { customRange.value = []; initAllCharts() }
const handleCustomRangeChange = () => { if (customRange.value && customRange.value.length === 2) autoRefresh.value = false; initAllCharts() }

const handleAutoRefreshChange = () => {
  clearInterval(chartTimer)
  if (autoRefresh.value) chartTimer = setInterval(initAllCharts, 5000)
}

const fetchLocksData = async () => {
  if (props.target.type.toLowerCase() === 'mysql') {
    lockData.value = await getLocks(props.target.id)
  }
}

const handleKill = async (threadId) => {
  const success = await killSession(props.target.id, threadId)
  if (success) fetchLocksData()
}

const showSlowDetails = async () => {
  slowData.value = await getTopSlow(props.target.id)
  slowDialogVisible.value = true
}

onMounted(() => {
  initAllCharts()
  chartTimer = setInterval(initAllCharts, 5000)
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
.control-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); flex-wrap: wrap; }
.control-left { display: flex; align-items: center; gap: 12px; min-width: 260px; }
.page-title { margin: 0; font-size: 18px; font-weight: 700; color: #111827; }
.control-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; flex: 1; }
.auto-refresh { display: flex; align-items: center; gap: 8px; }
.auto-refresh-label { font-size: 12px; color: #6b7280; }
.info-card-wrapper { background: #fff; border: 1px solid #e4e7ed; padding: 15px; text-align: center; border-radius: 8px; }
.info-label { font-size: 12px; color: #909399; margin-bottom: 8px; }
.info-content { font-size: 18px; font-weight: bold; color: #303133; }
.mini-metric-card { background: #fff; padding: 15px; border-radius: 8px; text-align: center; border-left: 4px solid #409EFF; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); }
.mini-metric-card.clickable { cursor: pointer; transition: all 0.2s; }
.mini-metric-card.clickable:hover { transform: translateY(-2px); box-shadow: 0 4px 12px 0 rgba(0,0,0,.1); }
.mini-metric-card .label { font-size: 12px; color: #909399; margin-bottom: 5px; }
.mini-metric-card .value { font-size: 22px; font-weight: bold; color: #303133; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-item { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.chart-header .title { font-weight: bold; color: #303133; }
.agg-stats { font-size: 12px; color: #606266; }
.agg-stats span { margin-left: 15px; }
.agg-stats b { color: #303133; }
.text-warning { color: #E6A23C; }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}

.overview-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.overview-card { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: 0 1px 10px rgba(15, 23, 42, 0.06); border: 1px solid rgba(226, 232, 240, 0.9); }
.overview-card.clickable { cursor: pointer; }
.overview-card.clickable:hover { box-shadow: 0 6px 20px rgba(15, 23, 42, 0.10); transform: translateY(-1px); transition: 0.15s; }
.overview-label { font-size: 11px; color: #6b7280; letter-spacing: 0.02em; }
.overview-value { margin-top: 6px; font-size: 20px; font-weight: 700; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 1200px) { .overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
