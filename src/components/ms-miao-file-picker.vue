<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useFilePickerStore } from '@/download/file-picker.ts'
import type { TaskFileMeta } from '@miao/thunder-client'

const store = useFilePickerStore()
const selected = ref<TaskFileMeta[]>([])

watch(
  () => store.visible,
  (visible) => {
    if (visible) selected.value = []
  }
)

function onSelectionChange(rows: TaskFileMeta[]) {
  selected.value = rows
}

function formatSize(size: number): string {
  const kb = 1024
  const mb = kb * 1024
  const gb = mb * 1024
  if (size >= gb) return (size / gb).toFixed(2) + ' GB'
  if (size >= mb) return (size / mb).toFixed(2) + ' MB'
  if (size >= kb) return (size / kb).toFixed(2) + ' KB'
  return size + ' B'
}

function confirm() {
  store.submit(selected.value.map((file) => file.index))
}

function cancel() {
  store.cancel()
}

function onVisibleChange(value: boolean) {
  // X / ESC / 遮罩关闭走这里，统一按取消结算挂起的 Promise
  if (!value) cancel()
}
</script>

<template>
  <el-dialog
    :model-value="store.visible"
    :title="`选择要下载的文件（${store.name}）`"
    width="640px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="onVisibleChange"
  >
    <el-table :data="store.files" max-height="360" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="48" />
      <el-table-column prop="index" label="#" width="60" />
      <el-table-column prop="path" label="路径" min-width="280" show-overflow-tooltip />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" :disabled="selected.length === 0" @click="confirm">
        下载勾选的 {{ selected.length }} 个文件
      </el-button>
    </template>
  </el-dialog>
</template>
