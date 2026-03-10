<template>
  <section class="stats-bar">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
              <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
            </svg>
          </div>
          <div class="stat-meta">
            <div class="stat-label">Total Databases</div>
            <div class="stat-value lm-num">{{ formatNumber(stats.total) }}</div>
          </div>
          <div class="stat-trend">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M21 7v6h-6" />
            </svg>
          </div>
        </div>
        <div class="stat-sub">Total databases trend</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-ico stat-ico-mysql">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 20c3-2 3-8 0-10" />
              <path d="M17 20c-3-2-3-8 0-10" />
              <path d="M8.5 4c1.5 1 5.5 1 7 0" />
              <path d="M9 8c2 1 4 1 6 0" />
            </svg>
          </div>
          <div class="stat-meta">
            <div class="stat-label">MySQL</div>
            <div class="stat-value lm-num">{{ formatNumber(stats.mysql) }}</div>
          </div>
          <div class="stat-trend">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M21 7v6h-6" />
            </svg>
          </div>
        </div>
        <div class="stat-sub">MySQL databases trend</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-ico stat-ico-mssql">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <ellipse cx="12" cy="6" rx="7" ry="3" />
              <path d="M5 6v8c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
            </svg>
          </div>
          <div class="stat-meta">
            <div class="stat-label">MSSQL</div>
            <div class="stat-value lm-num">{{ formatNumber(stats.mssql) }}</div>
          </div>
          <div class="stat-trend">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M21 7v6h-6" />
            </svg>
          </div>
        </div>
        <div class="stat-sub">MSSQL databases trend</div>
      </div>

      <div class="stat-card">
        <div class="stat-top">
          <div class="stat-ico stat-ico-oracle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="5" y="4" width="14" height="16" rx="3" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
              <path d="M9 16h6" />
            </svg>
          </div>
          <div class="stat-meta">
            <div class="stat-label">Oracle</div>
            <div class="stat-value lm-num">{{ formatNumber(stats.oracle) }}</div>
          </div>
          <div class="stat-trend">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M21 7v6h-6" />
            </svg>
          </div>
        </div>
        <div class="stat-sub">Oracle databases trend</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { formatNumber } from '../utils/formatNumber'

const props = defineProps({
  rows: { type: Array, default: () => [] }
})

const stats = computed(() => {
  const rows = props.rows || []
  const out = { total: rows.length, mysql: 0, oracle: 0, mssql: 0 }
  for (const r of rows) {
    const t = String(r?.type || '').toLowerCase()
    if (t === 'mysql') out.mysql += 1
    else if (t === 'oracle') out.oracle += 1
    else if (t === 'mssql') out.mssql += 1
  }
  return out
})
</script>

<style scoped>
.stats-bar { margin-bottom: var(--lm-space-4); }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); padding: 14px 14px; }
.stat-top { display: grid; grid-template-columns: 34px 1fr 18px; gap: 10px; align-items: center; }
.stat-ico { width: 34px; height: 34px; border-radius: 10px; background: #f3f4f6; display: grid; place-items: center; color: #334155; }
.stat-ico svg { width: 18px; height: 18px; }
.stat-ico-mysql { background: #eff6ff; color: #1d4ed8; }
.stat-ico-mssql { background: #ecfeff; color: #0e7490; }
.stat-ico-oracle { background: #fef2f2; color: #b91c1c; }
.stat-meta { display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: 12px; color: #6b7280; }
.stat-value { font-size: 24px; font-weight: 800; color: #111827; line-height: 1.1; }
.stat-trend { color: #64748b; display: grid; place-items: center; }
.stat-trend svg { width: 18px; height: 18px; }
.stat-sub { margin-top: 10px; font-size: 12px; color: #64748b; }
@media (max-width: 1100px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .stats-grid { grid-template-columns: 1fr; } }
</style>

