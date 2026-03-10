<template>
  <el-dialog v-model="dialogVisible" title="Add Target" width="600px" draggable destroy-on-close>
    <AddTargetForm ref="addFormRef" @saved="handleSaved" />
    <template #footer>
      <div class="dialog-footer">
        <div>
          <el-button :loading="addTesting" @click="handleAddTest">Test</el-button>
        </div>
        <div class="dialog-footer-right">
          <el-button @click="dialogVisible = false">Cancel</el-button>
          <el-button type="primary" :loading="addSaving" @click="handleAddSave">Save</el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <el-dialog v-model="editDialogVisible" title="Edit Target" width="600px" draggable destroy-on-close>
    <AddTargetForm ref="editFormRef" mode="edit" :target="editingTarget" @saved="handleEditSaved" />
    <template #footer>
      <div class="dialog-footer">
        <div></div>
        <div class="dialog-footer-right">
          <el-button @click="handleEditCancel">Cancel</el-button>
          <el-button type="primary" :loading="editSaving" @click="handleEditSave">Save</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, defineEmits, ref, defineExpose } from 'vue'
import AddTargetForm from './AddTargetForm.vue'

const emit = defineEmits(['changed'])

const dialogVisible = ref(false)
const editDialogVisible = ref(false)
const editingTarget = ref(null)
const addFormRef = ref(null)
const editFormRef = ref(null)

const addSaving = computed(() => !!addFormRef.value?.saving?.value)
const addTesting = computed(() => !!addFormRef.value?.testing?.value)
const editSaving = computed(() => !!editFormRef.value?.saving?.value)

const openAdd = () => {
  dialogVisible.value = true
}

const openEdit = (row) => {
  editingTarget.value = { ...row }
  editDialogVisible.value = true
}

const handleAddTest = () => {
  addFormRef.value?.testConnection?.()
}

const handleAddSave = () => {
  addFormRef.value?.saveTarget?.()
}

const handleEditSave = () => {
  editFormRef.value?.saveTarget?.()
}

const handleSaved = () => {
  dialogVisible.value = false
  emit('changed')
}

const handleEditSaved = () => {
  editDialogVisible.value = false
  editingTarget.value = null
  emit('changed')
}

const handleEditCancel = () => {
  editDialogVisible.value = false
  editingTarget.value = null
}

defineExpose({
  openAdd,
  openEdit
})
</script>

<style scoped>
.dialog-footer { display: flex; align-items: center; justify-content: space-between; }
.dialog-footer-right { display: flex; gap: 10px; }
</style>

