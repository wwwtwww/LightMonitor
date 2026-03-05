<template>
  <div class="app-container">
    <TargetList v-if="currentView === 'list'" @select="handleSelect" />
    <TargetDetail v-else :target="activeTarget" @back="handleBack" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import TargetList from './components/TargetList.vue'
import TargetDetail from './components/TargetDetail.vue'

const currentView = ref('list')
const activeTarget = ref({})

const handleSelect = (target) => {
  activeTarget.value = target
  currentView.value = 'detail'
}

const handleBack = () => {
  currentView.value = 'list'
  activeTarget.value = {}
}
</script>

<style scoped>
.app-container { max-width: 98%; margin: 0 auto; padding: 20px; background: var(--lm-bg); min-height: 100vh; }
</style>
