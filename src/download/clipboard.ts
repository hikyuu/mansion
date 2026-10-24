import { useSiteStore } from '@/store/site-store.ts'
import { useClipboard } from '@vueuse/core'

const { copy, copied, isSupported } = useClipboard()

const waitTime = 1000

/** 复制通道的结局；通知由下载意图层统一出 */
export interface CopyResult {
  ok: boolean
  message: string
}

interface CopyJob {
  text: string
  resolve: (result: CopyResult) => void
}

const waitQueue: CopyJob[] = []
let waiting = false

/**
 * 复制下载链接。
 * 节流队列串行执行，Promise 在真正复制完成时才 resolve，
 * 让上层通知反映真实结局而不是「已入队」这个乐观值。
 */
export function copyUrl(text: string): Promise<CopyResult> {
  if (!isSupported.value) {
    return Promise.resolve({ ok: false, message: '浏览器不支持剪贴板 API，请手动复制' })
  }
  if (!useSiteStore().isValid) {
    return Promise.resolve({ ok: false, message: '站点列表未加载完成，请稍后再试' })
  }
  return new Promise((resolve) => {
    waitQueue.push({ text, resolve })
    task()
  })
}

function task() {
  if (waiting) return
  const job = waitQueue.shift()
  if (!job) return
  waiting = true
  copy(job.text)
    .then(() => {
      const ok = copied.value
      job.resolve({ ok, message: ok ? '已复制下载链接' : '复制下载链接失败，请手动复制' })
    })
    .catch((reason) => {
      console.error('[copy] 复制失败', reason)
      job.resolve({ ok: false, message: '复制下载链接失败，请手动复制' })
    })
    .finally(() => {
      setTimeout(() => {
        waiting = false
        task()
      }, waitTime)
    })
}
