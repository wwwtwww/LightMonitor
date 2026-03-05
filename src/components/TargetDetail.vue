<template>
  <div class="detail-view">
    <div class="lm-header">
      <div class="lm-header-left">
        <el-button @click="emit('back')" icon="ArrowLeft">返回列表</el-button>
        <h2 class="page-title">
          <span class="title-sys">{{ systemName || '—' }}</span>
          <span class="title-sep"> / </span>
          <span class="title-db">{{ target.name || '—' }}</span>
        </h2>
      </div>

      <div class="lm-header-right">
        <el-radio-group v-model="timeRange" size="small" @change="handleRangeChange">
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
          size="small"
          style="width: 320px;"
        />

        <div class="auto-refresh">
          <span class="auto-refresh-label">自动刷新</span>
          <el-switch v-model="autoRefresh" size="small" @change="handleAutoRefreshChange" />
        </div>
      </div>
    </div>

    <el-card class="box-card" shadow="never" style="margin-bottom: 20px;">
      <template #header><b>监控概览</b></template>
      <el-row :gutter="12">
        <el-col v-for="item in overviewItems" :key="item.key" :span="6">
          <div class="overview-card" :class="{ clickable: item.clickable }" @click="item.onClick && item.onClick()">
            <div class="overview-label">{{ item.label }}</div>
            <div class="overview-value">{{ item.value }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 图表列表 -->
    <div class="charts-grid">
      <div class="chart-item" v-for="conf in chartConfigs" :key="conf.id" v-show="!conf.onlyMysql || target.type.toLowerCase() === 'mysql'">
        <div class="chart-header">
          <span class="title">{{ conf.title }} ({{ getRangeText() }})</span>
          <div class="agg-stats">
            <span>最大: <b>{{ chartAggs[conf.id]?.max || 0 }}</b></span>
            <span>最小: <b>{{ chartAggs[conf.id]?.min || 0 }}</b></span>
            <span>平均: <b>{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
          </div>
        </div>
        <div :id="conf.id" style="width: 100%; height: 280px;"></div>
      </div>
    </div>

    <el-card v-if="target.type.toLowerCase() === 'mysql'" shadow="never" style="margin-top: 20px; border-color: #F56C6C;">
        <template #header><div style="display:flex; justify-content:space-between"><b style="color: #F56C6C;">实时锁表监测</b><el-button size="small" type="danger" plain @click="fetchLocksData">刷新锁</el-button></div></template>
        <el-table :data="lockData" border stripe size="small" empty-text="暂无锁等待">
          <el-table-column prop="blocking_thread" label="源头" width="100" />
          <el-table-column prop="waiting_thread" label="被堵" width="100" />
          <el-table-column prop="lock_duration" label="时长(s)" width="100" />
          <el-table-column label="操作" width="80"><template #default="scope"><el-button type="danger" size="small" @click="handleKill(scope.row.blocking_thread)">KILL</el-button></template></el-table-column>
        </el-table>
    </el-card>

    <SlowQueryModal v-model:visible="slowDialogVisible" :data="slowData" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick, defineProps, defineEmits, onBeforeUnmount, computed } from 'vue'
import * as echarts from 'echarts'
import { ArrowLeft } from '@element-plus/icons-vue'
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
const systemName = computed(() => props.target.system_name || props.target.business_system || '')
const overviewItems = computed(() => {
  const isMysql = (props.target.type || '').toLowerCase() === 'mysql'
  const host = [props.target.host, props.target.port].filter(Boolean).join(':')
  const delayText = latestStats.value.slaveDelay >= 0 ? `${latestStats.value.slaveDelay}s` : '--'
  const items = [
    { key: 'db_type', label: 'DB TYPE', value: (props.target.type || '').toUpperCase() },
    { key: 'role', label: 'ROLE', value: roleText.value },
    { key: 'host', label: 'HOST', value: host || '--' },
    { key: 'sessions', label: 'SESSIONS', value: latestStats.value.sessions || 0 },
    { key: 'threads', label: 'THREADS', value: latestStats.value.threadsRunning || 0 },
  ]
  if (isMysql) {
    items.push(
      { key: 'qps', label: 'QPS', value: latestStats.value.qps || 0 },
      { key: 'tps', label: 'TPS', value: latestStats.value.tps || 0 },
      { key: 'slow', label: 'SLOW QUERY', value: latestStats.value.slowCount || 0, clickable: true, onClick: showSlowDetails },
    )
    if (isSlaveTarget()) items.push({ key: 'delay', label: 'DELAY', value: delayText })
  }
  return items
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
const handleCustomRangeChange = () => {
  if (customRange.value && customRange.value.length === 2) {
    autoRefresh.value = false
    clearInterval(chartTimer)
  }
  initAllCharts()
}

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
.page-title { margin: 0; font-size: 18px; font-weight: 700; color: #111827; }
.title-sys { color: #6b7280; font-weight: 500; }
.title-sep { color: #9ca3af; font-weight: 500; }
.title-db { color: #111827; font-weight: 800; }
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
.chart-item { background: #fff; padding: 20px; border-radius: 8px; box-shadow: var(--lm-shadow-md); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.chart-header .title { font-weight: bold; color: #303133; }
.agg-stats { font-size: 12px; color: #606266; }
.agg-stats span { margin-left: 15px; }
.agg-stats b { color: #303133; }
.text-warning { color: #E6A23C; }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
}

.overview-card { background: #fff; border-radius: 10px; padding: 12px 14px; box-shadow: var(--lm-shadow-sm); border: var(--lm-border); }
.overview-card.clickable { cursor: pointer; }
.overview-card.clickable:hover { box-shadow: 0 6px 20px rgba(15, 23, 42, 0.10); transform: translateY(-1px); transition: 0.15s; }
.overview-label { font-size: 11px; color: #6b7280; letter-spacing: 0.02em; }
.overview-value { margin-top: 6px; font-size: 20px; font-weight: 700; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
