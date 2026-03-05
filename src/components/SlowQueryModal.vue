<template>
  <el-dialog :model-value="visible" @update:model-value="emit('update:visible', $event)" title="慢查询语句分析" width="900px">
    <el-table :data="data" border stripe height="400" empty-text="暂无慢查询数据">
      <el-table-column prop="sql_text" label="SQL" show-overflow-tooltip />
      <el-table-column prop="exec_count" label="次数" width="80" />
      <el-table-column prop="max_time" label="平均耗时(ms)" width="120" />
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
