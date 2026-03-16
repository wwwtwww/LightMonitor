<template>
  <div class="layout-root">
    <aside class="layout-aside">
      <div class="brand">
        <div class="brand-name">LightMonitor</div>
        <div class="brand-sub">Light weight Monitoring</div>
      </div>

      <nav class="nav">
        <a class="nav-item" :class="{ 'is-active': active === 'overview' }" href="javascript:void(0)" @click.prevent="onSelect('overview')">Overview</a>
        <a class="nav-item" :class="{ 'is-active': active === 'mysql' }" href="javascript:void(0)" @click.prevent="onSelect('mysql')">MySQL</a>
        <a class="nav-item" :class="{ 'is-active': active === 'mssql' }" href="javascript:void(0)" @click.prevent="onSelect('mssql')">MSSQL</a>
        <a class="nav-item" :class="{ 'is-active': active === 'oracle' }" href="javascript:void(0)" @click.prevent="onSelect('oracle')">Oracle</a>
        <div class="nav-sep" />
        <a class="nav-item" :class="{ 'is-active': active === 'maintenance' }" href="javascript:void(0)" @click.prevent="onSelect('maintenance')">System Maintenance</a>
      </nav>
    </aside>
    <main class="layout-main">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

defineProps({
  active: { type: String, default: 'overview' }
})

const emit = defineEmits(['select'])

const onSelect = (key) => {
  emit('select', key)
}
</script>

<style scoped>
.layout-root { min-height: 100vh; background: var(--lm-bg); display: grid; grid-template-columns: 240px 1fr; }
.layout-aside { background: #2C3E50; border-right: none; padding: 14px 14px; display: flex; flex-direction: column; }
.layout-main { padding: 32px; min-width: 0; }
.brand { padding: 10px 10px 16px; }
.brand-name { font-size: 18px; font-weight: 800; color: #fff; line-height: 1.1; letter-spacing: 0.2px; }
.brand-sub { margin-top: 6px; font-size: 12px; color: rgba(255, 255, 255, 0.72); }
.nav { display: flex; flex-direction: column; gap: 6px; padding: 6px 6px; }
.nav-sep { height: 1px; background: rgba(255, 255, 255, 0.12); margin: 10px 0; }
.nav-item { color: rgba(255, 255, 255, 0.78); text-decoration: none; padding: 9px 10px; border-radius: 8px; font-size: 13px; }
.nav-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.nav-item.is-active { background: rgba(255, 255, 255, 0.16); color: #fff; }
</style>
