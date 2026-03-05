<template>
  <div class="summary-container">
    <div class="summary-header">监控概览 (STATUS SUMMARY)</div>
    <div class="cards-wrapper">
      
      <!-- MONITORING -->
      <div class="status-card">
        <div class="card-title">监控目标</div>
        <div class="bar-container single-bar gray">
          {{ onlineCount }} / {{ totalCount }}
        </div>
      </div>

      <!-- SESSIONS -->
      <div class="status-card">
        <div class="card-title">活跃连接</div>
        <div class="bar-container stacked">
          <div class="bar-segment red" title="总连接数">{{ totalSessions }}</div>
          <div class="bar-segment orange" title="告警数(>50)">{{ sessionStats.warning + sessionStats.critical }}</div>
        </div>
      </div>

      <!-- SLOW SQL -->
      <div class="status-card">
        <div class="card-title">慢查询</div>
        <div class="bar-container stacked">
          <div class="bar-segment red" title="总慢查询数">{{ totalSlow }}</div>
          <div class="bar-segment orange" title="有慢查询的库">{{ slowStats.warning + slowStats.critical }}</div>
        </div>
      </div>

      <!-- QPS -->
      <div class="status-card">
        <div class="card-title">总 QPS</div>
        <div class="bar-container stacked">
          <div class="bar-segment red" title="总 QPS">{{ totalQps }}</div>
          <div class="bar-segment orange" title="高负载库(>500)">{{ loadStats.warning + loadStats.critical }}</div>
        </div>
      </div>

      <!-- TPS -->
      <div class="status-card">
        <div class="card-title">总 TPS</div>
        <div class="bar-container stacked">
          <div class="bar-segment red" title="总 TPS">{{ totalTps }}</div>
          <!-- 复用 QPS 告警数作为负载参考 -->
          <div class="bar-segment orange" title="高负载库(>500)">{{ loadStats.warning + loadStats.critical }}</div>
        </div>
      </div>
      
    </div>
  </div>
</template>

<script setup>
import { computed, defineProps } from 'vue'

const props = defineProps({
  targets: {
    type: Array,
    default: () => []
  }
})

const totalCount = computed(() => props.targets.length)
const onlineCount = computed(() => props.targets.filter(t => (t.latest || {}).online).length)

// 计算总量
const sumField = (field) => props.targets.reduce((acc, t) => acc + ((t.latest || {})[field] || 0), 0)
const totalSessions = computed(() => sumField('sessions'))
const totalSlow = computed(() => sumField('slowCount'))
const totalQps = computed(() => sumField('qps'))
const totalTps = computed(() => sumField('tps'))

// 统计告警
const countAlerts = (field, warnThreshold, critThreshold) => {
  let warning = 0, critical = 0
  props.targets.forEach(t => {
    const val = (t.latest || {})[field] || 0
    if (val >= critThreshold) critical++
    else if (val >= warnThreshold) warning++
  })
  return { warning, critical }
}

const sessionStats = computed(() => countAlerts('sessions', 50, 100))
const slowStats = computed(() => countAlerts('slowCount', 1, 5))
const loadStats = computed(() => countAlerts('qps', 500, 1000))

</script>

<style scoped>
.summary-container {
  margin-bottom: 20px;
  background-color: #fff; /* 确保背景是白色的，虽然可能放在灰色背景上 */
}

.summary-header {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 10px;
  color: #333;
  text-transform: uppercase;
}

.cards-wrapper {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
}

.status-card {
  width: 100px; /* 固定宽度，稍微窄一点以适应多列 */
  background: #fff;
  border: 1px solid #ddd; /* 细边框 */
  padding: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05); /* 轻微阴影 */
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: 11px;
  font-weight: bold;
  text-align: center;
  margin-bottom: 6px;
  color: #333;
  text-transform: uppercase;
  border-bottom: 2px solid #ddd; /* 标题下划线 */
  padding-bottom: 4px;
}

.bar-container {
  height: 50px; /* 色块高度 */
  display: flex;
  flex-direction: column;
  width: 100%;
}

.bar-container.single-bar {
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  font-size: 14px;
}

.bar-container.stacked .bar-segment {
  flex: 1; /* 平分高度 */
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  font-size: 14px;
  width: 100%;
}

/* 颜色定义 */
.gray { background-color: #808080; }
.red { background-color: #C00000; } /* 深红 */
.orange { background-color: #E6A23C; } /* 警告橙/黄 */
/* 可以尝试更接近图片的橙色: #F0AD4E 或 #FFC000 */
.orange { background-color: #fca130; } 

/* 边框微调：stacked 模式下中间加个白线分割 */
.bar-container.stacked .bar-segment:first-child {
  border-bottom: 1px solid #fff;
}
</style>
