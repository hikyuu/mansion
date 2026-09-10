<script lang="ts" setup>
import { computed } from 'vue'
import { useReactStore } from '@/store/react-store'
import { useDownloadQueueStore, type DownloadQueueStatus } from '@/store/download-queue-store'

const queue = useDownloadQueueStore()
const react = useReactStore()

const visible = computed(() => queue.items.length > 0)

const statusMeta: Record<
  DownloadQueueStatus,
  { label: string; type: 'info' | 'warning' | 'success' | 'danger' }
> = {
  pending: { label: '等待', type: 'info' },
  running: { label: '下载中', type: 'warning' },
  success: { label: '已提交', type: 'success' },
  skipped: { label: '无更新', type: 'info' },
  failed: { label: '失败', type: 'danger' }
}

function shortTitle(title: string, max = 22): string {
  if (title.length <= max) return title
  return `${title.slice(0, max)}…`
}

function itemTooltip(title: string, message?: string): string {
  return message ? `${title} — ${message}` : title
}
</script>

<template>
  <!-- 宽屏：左侧固定卡片，复用 .mansion-left 定位 -->
  <el-card v-if="react.wgt1670 && visible" class="mansion-left">
    <el-text tag="b" style="font-size: 14px">下载队列 {{ queue.successCount }}/{{ queue.total }}</el-text>

    <div class="queue-list">
      <div v-for="item in queue.items" :key="item.id" class="queue-item">
        <el-tag size="small" :type="statusMeta[item.status].type">
          {{ statusMeta[item.status].label }}
        </el-tag>
        <el-text
          size="small"
          truncated
          :title="itemTooltip(item.title, item.message)"
          style="margin-left: 4px; flex: 1; min-width: 0"
        >
          {{ shortTitle(item.title) }}
        </el-text>
      </div>
    </div>
  </el-card>

  <!-- 窄屏：左下角紧凑徽标 -->
  <div v-else-if="visible" class="queue-badge">
    <el-tag :type="queue.busy ? 'warning' : 'info'" effect="dark" size="large">
      队列 {{ queue.successCount }}/{{ queue.total }}
    </el-tag>
  </div>
</template>

<style scoped>
.mansion-left {
  position: fixed;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  z-index: 2000;
  width: 160px;
}
/* 收窄卡片内边距，把省下的空间留给标题 */
.mansion-left :deep(.el-card__body) {
  padding: 10px;
}
.queue-list {
  max-height: 40vh;
  overflow-y: auto;
  margin-top: 6px;
}
.queue-item {
  display: flex;
  align-items: center;
  margin: 2px 0;
}
.queue-badge {
  position: fixed;
  left: 0;
  bottom: 0;
  z-index: 2000;
  padding: 4px;
}
</style>
