<script lang="ts" setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { type TableInstance } from 'element-plus'
import { isVideoFile, useFilePickerStore } from '@/download/file-picker.ts'
import type { TaskFileMeta } from '@hikyuu/thunder-client'

const store = useFilePickerStore()
const selected = ref<TaskFileMeta[]>([])
const tableRef = ref<TableInstance>()

// 每次展示弹窗（含排队时切换到下一个种子）都重算默认勾选：视频文件全选，其余保持未勾
watch(
  () => (store.visible ? store.files : null),
  async (files) => {
    if (!files) return
    selected.value = []
    await nextTick()
    const table = tableRef.value
    if (!table) return
    table.clearSelection()
    for (const file of files) {
      if (isVideoFile(file.path)) table.toggleRowSelection(file, true)
    }
  },
  { flush: 'post' }
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

/**
 * 弹窗打开期间 Enter 归弹窗独占：确认勾选。
 *
 * 页面级 Enter 已被占用（Enter=下载当前妹妹、Ctrl+Enter=onejav 跳下一天），
 * 放行会与确认撞车，所以在 capture 阶段就掐断传播，全局监听收不到这次按键。
 * 焦点落在按钮上时保留浏览器原生激活（在「取消」上按 Enter 应是取消），避免一键双触发。
 */
function onKeydown(event: KeyboardEvent) {
  if (!store.visible || event.key !== 'Enter' || event.isComposing) return
  event.stopImmediatePropagation()
  if (event.target instanceof HTMLElement && event.target.closest('button')) return
  event.preventDefault()
  if (selected.value.length === 0) return
  confirm()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
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
    <el-table
      ref="tableRef"
      :data="store.files"
      max-height="360"
      @selection-change="onSelectionChange"
    >
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
