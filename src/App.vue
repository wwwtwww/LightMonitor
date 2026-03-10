<template>
  <SidebarLayout :active="activeMenu" @select="handleMenuSelect">
    <DetailLayout v-if="activeTarget" :target="activeTarget" @back="handleBack" />
    <OverviewList
      v-else-if="activeMenu === 'overview'"
      :rows="tableData"
      :refresh="fetchList"
      :delete-target="deleteTarget"
      @select="handleSelect"
    />
    <MysqlList
      v-else-if="activeMenu === 'mysql'"
      :rows="tableData"
      :refresh="fetchList"
      :delete-target="deleteTarget"
      @select="handleSelect"
    />
    <SqlServerList
      v-else-if="activeMenu === 'mssql'"
      :rows="tableData"
      :refresh="fetchList"
      :delete-target="deleteTarget"
      @select="handleSelect"
    />
    <OracleList
      v-else-if="activeMenu === 'oracle'"
      :rows="tableData"
      :refresh="fetchList"
      :delete-target="deleteTarget"
      @select="handleSelect"
    />
    <SystemMaintenance v-else-if="activeMenu === 'maintenance'" />
  </SidebarLayout>
</template>

<script setup>
import { ref } from 'vue'
import SidebarLayout from './layouts/SidebarLayout.vue'
import OverviewList from './views/OverviewList.vue'
import MysqlList from './views/MysqlList.vue'
import SqlServerList from './views/SqlServerList.vue'
import OracleList from './views/OracleList.vue'
import DetailLayout from './views/DetailLayout.vue'
import SystemMaintenance from './views/SystemMaintenance.vue'
import { useTargetsStore } from './composables/useTargetsStore'

const activeMenu = ref('overview')
const activeTarget = ref(null)

const { tableData, fetchList, deleteTarget } = useTargetsStore()

const handleSelect = (target) => {
  activeTarget.value = target
}

const handleBack = () => {
  activeTarget.value = null
}

const handleMenuSelect = (key) => {
  activeMenu.value = key
  activeTarget.value = null
}
</script>

<style>
body {
  margin: 0;
  color: var(--lm-text);
  background: var(--lm-bg);
}

.el-button,
.el-input__inner,
.el-menu,
.el-menu-item,
.el-sub-menu__title,
.el-table,
.el-table__header-wrapper,
.el-table__body-wrapper,
.el-card,
.el-tag,
.el-radio-button__inner,
.el-switch,
.el-select,
.el-dropdown,
.el-dialog,
.el-message {
  font-family: var(--lm-font-sans);
}

.lm-table-card {
  border-radius: var(--lm-radius-md);
  box-shadow: var(--lm-shadow-md);
  border: var(--lm-border);
}

.lm-table-card .el-card__body {
  padding: var(--lm-space-3) var(--lm-space-4);
}

.lm-table-card .el-table .el-table__cell {
  padding-top: var(--lm-space-3);
  padding-bottom: var(--lm-space-3);
}
</style>
