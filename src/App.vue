<template>
  <div class="app-container">
    <!-- ==================== 视图 1：监控列表 ==================== -->
    <div v-if="currentView === 'list'">
      <h1 class="app-title">LightMonitor 数据库监控中心</h1>
      <el-card class="box-card" style="margin-bottom: 20px;">
        <template #header><div class="card-header"><span>➕ 新增监控目标</span></div></template>
        <el-form :inline="true" :model="form" size="default">
          <el-form-item label="名称"><el-input v-model="form.name" style="width: 150px"/></el-form-item>
          <el-form-item label="类型">
            <el-select v-model="form.type" style="width: 120px">
              <el-option label="MySQL" value="mysql" /><el-option label="Oracle" value="oracle" /><el-option label="SQL Server" value="sqlserver" />
            </el-select>
          </el-form-item>
          <el-form-item label="IP"><el-input v-model="form.host" style="width: 140px"/></el-form-item>
          <el-form-item label="端口"><el-input v-model.number="form.port" style="width: 80px"/></el-form-item>
          <el-form-item label="用户"><el-input v-model="form.user" style="width: 100px"/></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password style="width: 100px"/></el-form-item>
          <el-form-item>
            <el-button type="warning" @click="testConnection">测试</el-button>
            <el-button type="primary" @click="saveTarget">保存</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card class="box-card">
        <el-table :data="tableData" border stripe empty-text="暂无数据，请在上方添加">
          <el-table-column prop="id" label="ID" width="220" align="center" show-overflow-tooltip />
          <el-table-column label="状态" width="100" align="center">
            <template #default="scope">
              <el-tag :type="getLatest(scope.row).online ? 'success' : 'danger'" effect="dark">{{ getLatest(scope.row).online ? '在线' : '离线' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="数据库别名" />
          <el-table-column prop="type" label="类型" width="100" align="center"><template #default="scope"><el-tag effect="plain">{{ scope.row.type.toUpperCase() }}</el-tag></template></el-table-column>
          <el-table-column label="地址" show-overflow-tooltip>
            <template #default="scope">{{ scope.row.host }}:{{ scope.row.port }}</template>
          </el-table-column>
          <el-table-column label="连接数" width="120" align="center">
            <template #default="scope"><b style="color: #409EFF; font-size: 16px;">{{ getLatest(scope.row).sessions || 0 }}</b></template>
          </el-table-column>
          <el-table-column label="QPS" width="100" align="center">
            <template #default="scope">{{ getLatest(scope.row).qps || 0 }}</template>
          </el-table-column>
          <el-table-column label="TPS" width="100" align="center">
            <template #default="scope">{{ getLatest(scope.row).tps || 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="center">
            <template #default="scope">
              <el-button link type="primary" size="small" @click="enterDetail(scope.row)">🔍 进入监控</el-button>
              <span style="color: #e0e0e0; margin: 0 5px;">|</span>
              <el-button link type="danger" size="small" @click="deleteTarget(scope.row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <!-- ==================== 视图 2：详情页 (Grafana 风格) ==================== -->
    <div v-else class="detail-view">
      <!-- 顶部控制条 -->
      <div class="control-bar">
        <el-button @click="goBack" icon="ArrowLeft">返回列表</el-button>
        <h2 style="margin:0 20px">{{ activeTarget.name }}</h2>
        
        <el-radio-group v-model="timeRange" size="default" @change="handleRangeChange" style="margin-right: 20px;">
          <el-radio-button label="1">近1h</el-radio-button>
          <!-- 目前后端只实现了1h和按天，前端先保留1h选项，或者未来扩展 -->
        </el-radio-group>

        <el-date-picker v-model="historyDate" type="date" placeholder="选择具体日期" value-format="YYYY-MM-DD" :disabled-date="d => d.getTime() > Date.now()" @change="handleDateChange" size="default" style="width: 150px;" />

        <div style="margin-left:auto; display:flex; align-items:center">
          <span style="font-size:14px; color:#606266; margin-right:8px">自动刷新</span>
          <el-switch v-model="autoRefresh" @change="handleAutoRefreshChange" />
        </div>
      </div>

      <!-- 顶部基础信息 (Card 布局) -->
      <el-row :gutter="15" style="margin-bottom: 15px;">
        <el-col :span="6"><div class="info-card-wrapper"><div class="info-label">数据库类型</div><el-tag effect="dark" :color="getDbTypeColor(activeTarget.type)">{{ activeTarget.type.toUpperCase() }}</el-tag></div></el-col>
        <el-col :span="6"><div class="info-card-wrapper"><div class="info-label">主机地址</div><div class="info-content">{{ activeTarget.host }}:{{ activeTarget.port }}</div></div></el-col>
        <el-col :span="6"><div class="info-card-wrapper"><div class="info-label">用户</div><div class="info-content">{{ activeTarget.user }}</div></div></el-col>
        <el-col :span="6"><div class="info-card-wrapper"><div class="info-label">实时连接数</div><div class="info-content" style="color: #409EFF">{{ currentStats.sessions || 0 }}</div></div></el-col>
      </el-row>

      <!-- MySQL 专属实时面板 -->
      <div v-if="activeTarget.type.toLowerCase() === 'mysql'">
        <el-row :gutter="15" style="margin-bottom: 15px;">
          <el-col :span="6"><div class="mini-metric-card"><div class="label">QPS</div><div class="value">{{ currentStats.qps || 0 }}</div></div></el-col>
          <el-col :span="6"><div class="mini-metric-card"><div class="label">TPS</div><div class="value">{{ currentStats.tps || 0 }}</div></div></el-col>
          <el-col :span="6"><div class="mini-metric-card clickable" @click="showSlowDetails"><div class="label">慢查询<el-icon style="float:right"><View/></el-icon></div><div class="value text-warning">{{ currentStats.slowCount || 0 }}</div></div></el-col>
          <el-col :span="6"><div class="mini-metric-card"><div class="label">活跃线程</div><div class="value">{{ currentStats.sessions || 0 }}</div></div></el-col>
        </el-row>

        <el-card shadow="never" style="margin-bottom: 20px; border-color: #F56C6C;">
          <template #header><div style="display:flex; justify-content:space-between"><b style="color: #F56C6C;">🔒 实时锁表监测</b><el-button size="small" type="danger" plain @click="fetchLocks">刷新锁</el-button></div></template>
          <el-table :data="lockData" border stripe size="small">
            <el-table-column prop="blocking_thread" label="源头" width="100" />
            <el-table-column prop="waiting_thread" label="被堵" width="100" />
            <el-table-column prop="lock_duration" label="时长(s)" width="100" />
            <el-table-column label="操作" width="80"><template #default="scope"><el-button type="danger" size="small" @click="killSession(scope.row.blocking_thread)">KILL</el-button></template></el-table-column>
          </el-table>
        </el-card>
      </div>

      <!-- 图表列表 -->
      <div class="charts-grid">
        <div class="chart-item" v-for="conf in chartConfigs" :key="conf.id" v-show="!conf.onlyMysql || activeTarget.type.toLowerCase() === 'mysql'">
          <div class="chart-header">
            <span class="title">📈 {{ conf.title }} ({{ historyDate || '近'+timeRange+'h' }})</span>
            <div class="agg-stats">
              <span>最大: <b>{{ chartAggs[conf.id]?.max || 0 }}</b></span>
              <span>最小: <b>{{ chartAggs[conf.id]?.min || 0 }}</b></span>
              <span>平均: <b>{{ chartAggs[conf.id]?.avg || 0 }}</b></span>
            </div>
          </div>
          <div :id="conf.id" style="width: 100%; height: 280px;"></div>
        </div>
      </div>
    </div>

    <!-- 慢查询详情 -->
    <el-dialog v-model="slowDialogVisible" title="🐢 慢查询语句分析" width="900px">
      <el-table :data="slowData" border stripe height="400">
        <el-table-column prop="sql_text" label="SQL" show-overflow-tooltip />
        <el-table-column prop="exec_count" label="次数" width="80" />
        <el-table-column prop="max_time" label="平均耗时(ms)" width="120" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, nextTick, onUnmounted, reactive } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as echarts from 'echarts'
import { View, ArrowLeft } from '@element-plus/icons-vue'

const API_URL = '/api' // Same origin

const currentView = ref('list'), tableData = ref([]), activeTarget = ref({})
const form = ref({ id: '', name: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' })
const timeRange = ref("1"), historyDate = ref(''), autoRefresh = ref(true)
const lockData = ref([]), slowData = ref([]), slowDialogVisible = ref(false)
const chartAggs = reactive({})

let timers = { stats: null, charts: null }, chartInstances = {}

const chartConfigs = [
  { id: 'chart_conn', metric: 'sessions', title: '连接数趋势', color: '#409EFF' },
  { id: 'chart_qps', metric: 'qps', title: 'QPS 趋势', color: '#67C23A', onlyMysql: true },
  { id: 'chart_tps', metric: 'tps', title: 'TPS 趋势', color: '#E6A23C', onlyMysql: true }
]

const getLatest = (row) => row.latest || {}
const currentStats = computed(() => {
  // Try to find updated stats in tableData
  const found = tableData.value.find(d => d.id === activeTarget.value.id)
  return found ? (found.latest || {}) : {}
})

const getDbTypeColor = (t) => {
  const type = (t || '').toLowerCase()
  return ({ mysql: '#409EFF', oracle: '#F56C6C', sqlserver: '#E6A23C' }[type] || '#909399')
}

const drawSingleChart = async (conf) => {
  const dom = document.getElementById(conf.id)
  if (!dom) return
  let url = `${API_URL}/databases/${activeTarget.value.id}/metrics?range=1h`
  if (historyDate.value) url = `${API_URL}/databases/${activeTarget.value.id}/metrics?date=${historyDate.value}`

  try {
    const res = await axios.get(url)
    const rawData = res.data.data || []
    
    const times = rawData.map(d => {
        const date = new Date(d.ts)
        return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
    })
    const values = rawData.map(d => d[conf.metric] || 0)
    
    // 计算聚合数据
    if (values.length) {
      const sum = values.reduce((a, b) => a + b, 0)
      chartAggs[conf.id] = { max: Math.max(...values).toFixed(2), min: Math.min(...values).toFixed(2), avg: (sum / values.length).toFixed(2) }
    } else {
        chartAggs[conf.id] = { max: 0, min: 0, avg: 0 }
    }

    if (!chartInstances[conf.id]) chartInstances[conf.id] = echarts.init(dom)
    chartInstances[conf.id].setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: '40', right: '20', top: '20', bottom: '30' },
      xAxis: { type: 'category', data: times, axisLabel: { color: '#999' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
      series: [{ data: values, type: 'line', smooth: true, showSymbol: false, itemStyle: { color: conf.color }, areaStyle: { opacity: 0.1 } }]
    })
  } catch (e) {
    console.error(e)
  }
}

const initAllCharts = () => {
  nextTick(() => chartConfigs.forEach(conf => (!conf.onlyMysql || activeTarget.value.type.toLowerCase() === 'mysql') && drawSingleChart(conf)))
}

const handleRangeChange = () => { historyDate.value = ''; initAllCharts() }
const handleDateChange = () => { if (historyDate.value) autoRefresh.value = false; initAllCharts() }

const handleAutoRefreshChange = () => {
  clearInterval(timers.charts)
  if (autoRefresh.value) timers.charts = setInterval(initAllCharts, 5000)
}

const enterDetail = (row) => {
  activeTarget.value = row; currentView.value = 'detail'; historyDate.value = ''; timeRange.value = "1"
  initAllCharts()
  timers.charts = setInterval(initAllCharts, 5000)
  fetchLocks()
}

const goBack = () => {
  currentView.value = 'list'; clearInterval(timers.charts)
  Object.values(chartInstances).forEach(i => i.dispose()); chartInstances = {}
}

const fetchList = async () => tableData.value = (await axios.get(`${API_URL}/databases`)).data.data

const testConnection = async () => {
  if (!form.value.id) return ElMessage.warning('请先保存后再测试')
  try {
    const res = await axios.post(`${API_URL}/databases/${form.value.id}/test`)
    const r = res.data
    if (r.ok) ElMessage.success(`连接成功 ${r.latencyMs}ms`)
    else ElMessage.error(r.error || '连接失败')
  } catch (e) {
    ElMessage.error('连接失败')
  }
}

const saveTarget = async () => {
  const payload = { ...form.value }
  // 密码处理
  if (!payload.password) delete payload.password
  try {
    if (payload.id) {
        await axios.put(`${API_URL}/databases/${payload.id}`, payload)
    } else {
        await axios.post(`${API_URL}/databases`, payload)
    }
    ElMessage.success('保存成功')
    fetchList()
    // 清空表单，保留部分默认值
    form.value = { id: '', name: '', type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: '' }
  } catch (e) {
    ElMessage.error('保存失败')
  }
}

const deleteTarget = async (id) => {
  try {
    await ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' })
    await axios.delete(`${API_URL}/databases/${id}`)
    ElMessage.success('已删除')
    fetchList()
  } catch {}
}

const fetchLocks = async () => {
  if (activeTarget.value.type.toLowerCase() === 'mysql') {
      try {
        const res = await axios.get(`${API_URL}/databases/${activeTarget.value.id}/mysql/locks`)
        lockData.value = (res.data.waits || []).map(w => ({
            blocking_thread: w.blockedBy,
            waiting_thread: w.threadId,
            lock_duration: w.waitingSec,
            blocking_query: '-', // Backend doesn't provide SQL text yet
            waiting_query: '-'
        }))
      } catch {}
  }
}

const killSession = async (id) => {
  try {
    await ElMessageBox.confirm(`确定强杀线程 ${id}?`, '警告', { type: 'error' })
    const res = await axios.post(`${API_URL}/databases/${activeTarget.value.id}/mysql/kill`, {threadId: id})
    if (res.data.ok) {
        ElMessage.success('已发送 KILL')
        fetchLocks()
    } else {
        ElMessage.error(res.data.error || '操作失败')
    }
  } catch {}
}

const showSlowDetails = async () => {
  try {
    const res = await axios.get(`${API_URL}/databases/${activeTarget.value.id}/mysql/top-slow`)
    slowData.value = (res.data.data || []).map(x => ({
        sql_text: x.sql,
        exec_count: x.count,
        max_time: x.avgLatencyMs // Close enough approximation
    }))
    slowDialogVisible.value = true
  } catch {}
}

onMounted(() => {
    fetchList()
    // 全局列表刷新
    timers.stats = setInterval(fetchList, 3000)
})
onUnmounted(() => { clearInterval(timers.stats); clearInterval(timers.charts) })
</script>

<style scoped>
.app-container { max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f7fa; min-height: 100vh; }
.app-title { text-align: center; color: #303133; margin-bottom: 30px; }
.control-bar { display: flex; align-items: center; background: #fff; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); }
.info-card-wrapper { background: #fff; border: 1px solid #e4e7ed; padding: 15px; text-align: center; border-radius: 8px; }
.info-label { font-size: 12px; color: #909399; margin-bottom: 8px; }
.info-content { font-size: 18px; font-weight: bold; color: #303133; }
.mini-metric-card { background: #fff; padding: 15px; border-radius: 8px; text-align: center; border-left: 4px solid #409EFF; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); }
.mini-metric-card.clickable { cursor: pointer; transition: all 0.2s; }
.mini-metric-card.clickable:hover { transform: translateY(-2px); box-shadow: 0 4px 12px 0 rgba(0,0,0,.1); }
.mini-metric-card .label { font-size: 12px; color: #909399; margin-bottom: 5px; }
.mini-metric-card .value { font-size: 22px; font-weight: bold; color: #303133; }
.charts-grid { display: flex; flex-direction: column; gap: 20px; }
.chart-item { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0,0,0,.05); }
.chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
.chart-header .title { font-weight: bold; color: #303133; }
.agg-stats { font-size: 12px; color: #606266; }
.agg-stats span { margin-left: 15px; }
.agg-stats b { color: #303133; }
.text-warning { color: #E6A23C; }
</style>
