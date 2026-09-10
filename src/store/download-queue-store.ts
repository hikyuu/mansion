import { defineStore } from 'pinia'
import type { DownloadOutcome } from '@/site/exhentai/exhentai-download-handler'

/** 入队所需的可序列化元数据（不持有 jQuery / Dayjs，避免被 reactive 包装） */
export interface EnqueueDownloadItem {
  gid: string
  title: string
  titleHash: string
  index: number
  /** 页面画廊日期的时间戳，执行时用 dayjs(dateMs) 重建 */
  dateMs: number
}

export type DownloadQueueStatus = 'pending' | 'running' | 'success' | 'skipped' | 'failed'

export interface DownloadQueueItem extends EnqueueDownloadItem {
  /** 幂等键，等于 String(gid) */
  id: string
  status: DownloadQueueStatus
  message?: string
  addedAt: number
}

export type DownloadQueueExecutor = (item: DownloadQueueItem) => Promise<DownloadOutcome>

/** 模块级、非响应式：执行器由站点在 mount() 时注册 */
let executor: DownloadQueueExecutor | undefined

export function setDownloadQueueExecutor(fn: DownloadQueueExecutor): void {
  executor = fn
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export const useDownloadQueueStore = defineStore('downloadQueue', {
  state: (): {
    items: DownloadQueueItem[]
    paused: boolean
    workNumber: number
    limit: number
    intervalMs: number
  } => ({
    items: [],
    paused: false,
    workNumber: 0,
    limit: 2,
    intervalMs: 1500
  }),

  getters: {
    total: (state): number => state.items.length,
    pendingCount: (state): number => state.items.filter((i) => i.status === 'pending').length,
    runningCount: (state): number => state.items.filter((i) => i.status === 'running').length,
    successCount: (state): number => state.items.filter((i) => i.status === 'success').length,
    failedCount: (state): number => state.items.filter((i) => i.status === 'failed').length,
    /** 是否还有在途任务或待启动任务 */
    busy: (state): boolean => state.workNumber > 0 || state.items.some((i) => i.status === 'pending')
  },

  actions: {
    /** 批量/单项入队；按 gid 幂等；失败项可被重新激活 */
    enqueue(payload: EnqueueDownloadItem | EnqueueDownloadItem[]) {
      const list = Array.isArray(payload) ? payload : [payload]
      let changed = false
      for (const item of list) {
        const id = String(item.gid)
        const exist = this.items.find((i) => i.id === id)
        if (exist) {
          if (exist.status === 'failed') {
            exist.status = 'pending'
            exist.message = ''
            changed = true
          }
          continue
        }
        this.items.push({ ...item, id, status: 'pending', addedAt: Date.now() })
        changed = true
      }
      if (changed) {
        void this.drain()
      }
    },

    /** 调整并发数（默认 2），调大后立即补位 */
    setLimit(limit: number) {
      this.limit = Math.max(1, Math.floor(limit))
      void this.drain()
    },

    pause() {
      this.paused = true
    },

    resume() {
      this.paused = false
      void this.drain()
    },

    /** 清空队列；已在途的任务无法取消，其 finally 会自行收尾 */
    clear() {
      this.items = []
    },

    retry(id: string) {
      const item = this.items.find((i) => i.id === id)
      if (!item || item.status === 'running') return
      item.status = 'pending'
      item.message = ''
      void this.drain()
    },

    /**
     * 并行调度：最多 limit 个任务同时执行。
     * 循环体内无 await，整个取任务过程同步完成，因此不会重复启动同一项。
     */
    async drain() {
      if (this.paused || !executor) return
      while (this.workNumber < this.limit) {
        const next = this.items.find((i) => i.status === 'pending')
        if (!next) break
        next.status = 'running'
        this.workNumber++
        void this.runOne(next)
      }
    },

    /** 执行单项；每个槽位完成后各等一个间隔再取下一项，避免集中打满下载器 */
    async runOne(item: DownloadQueueItem) {
      try {
        if (!executor) {
          item.status = 'failed'
          item.message = '执行器未注册'
          return
        }
        const outcome = await executor(item)
        if (!outcome.ok) {
          item.status = 'failed'
        } else if (outcome.downloaded) {
          item.status = 'success'
        } else {
          // 流程正常走完但没有可下载的更新（例如复查后仍是 no-newer-seed）
          item.status = 'skipped'
        }
        item.message = outcome.message
      } catch (err) {
        item.status = 'failed'
        item.message = err instanceof Error ? err.message : String(err)
      } finally {
        this.workNumber = Math.max(0, this.workNumber - 1)
        await sleep(this.intervalMs)
        if (!this.paused) {
          void this.drain()
        }
      }
    }
  }
})
