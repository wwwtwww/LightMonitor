<template>
  <el-card shadow="never">
    <el-empty :description="description" />
  </el-card>
</template>

<script setup>
import { computed, defineProps } from 'vue'

const props = defineProps({
  dbType: { type: String, default: '' }
})

const description = computed(() => `${(props.dbType || 'This type').toUpperCase()} metrics panel is not available yet`)
</script>

