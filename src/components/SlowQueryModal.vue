<template>
  <el-dialog :model-value="visible" @update:model-value="emit('update:visible', $event)" title="Slow Query Analysis" width="900px">
    <el-table :data="data" :border="false" stripe height="400" empty-text="No slow queries">
      <el-table-column prop="sql_text" label="SQL" show-overflow-tooltip />
      <el-table-column prop="exec_count" label="Count" width="90" align="right" header-align="right">
        <template #default="scope"><span class="lm-num">{{ scope.row.exec_count }}</span></template>
      </el-table-column>
      <el-table-column prop="max_time" label="Avg Latency (ms)" width="140" align="right" header-align="right">
        <template #default="scope"><span class="lm-num">{{ scope.row.max_time }}</span></template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

const props = defineProps({
  visible: Boolean,
  data: Array
})

const emit = defineEmits(['update:visible'])
</script>
