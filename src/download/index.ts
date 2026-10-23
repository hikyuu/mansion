import { thunderDownload } from '@/download/thunder.ts'
import { copyUrl } from '@/download/clipboard.ts'
import { miaoDownload } from '@/download/miao.ts'
import { useConfigStore, type DownloadMethod } from '@/store/config-store.ts'
import { ElNotification } from 'element-plus'

export type { DownloadMethod } from '@/store/config-store.ts'

export interface DownloadSubmitResult {
  /** 是否真实提交成功（miao 已建任务 / 迅雷协议调用未抛错 / 复制已入队） */
  ok: boolean
  channel: 'miao' | 'thunder' | 'copy'
  /** 是否走了「miao 优先失败回退迅雷」的回退 */
  fellBack: boolean
  message: string
}

/**
 * 下载分发入口：miao 优先（默认，失败回退迅雷协议）/ 迅雷协议 / 复制链接。
 * 内部永不 reject，结局统一由 DownloadSubmitResult 表达。
 */
export async function download(url: string): Promise<DownloadSubmitResult> {
  let method: DownloadMethod = 'miao'
  try {
    method = useConfigStore().getSiteConfig.downloadMethod
    switch (method) {
      case 'thunder':
        return submitThunder(url, false)
      case 'copy': {
        const ok = await copyUrl(url)
        return { ok, channel: 'copy', fellBack: false, message: ok ? '已复制下载链接到剪贴板' : '复制下载链接失败' }
      }
      default:
        return await submitMiao(url)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, channel: method, fellBack: false, message }
  }
}

/** miao 优先：失败或 URL 不支持时回退迅雷 */
async function submitMiao(url: string): Promise<DownloadSubmitResult> {
  const attempt = await miaoDownload(url)
  if (attempt.status === 'created') {
    return { ok: true, channel: 'miao', fellBack: false, message: attempt.message }
  }
  if (attempt.status === 'cancelled') {
    return { ok: false, channel: 'miao', fellBack: false, message: attempt.message }
  }
  return submitThunder(url, true, attempt.message)
}

/**
 * 迅雷协议提交。
 * 回退场景下统一出一条通知（含原因），关闭通道内通知避免重复刷屏。
 */
function submitThunder(url: string, fellBack: boolean, reason = ''): DownloadSubmitResult {
  const ok = thunderDownload(url, { silent: fellBack })
  if (fellBack) {
    console.warn('[download] 回退迅雷', { url, ok, reason })
    const message = ok ? `已回退迅雷：${reason}` : `已回退迅雷失败：${reason}`
    ElNotification({ title: '迅雷下载', message, type: ok ? 'warning' : 'error' })
    return { ok, channel: 'thunder', fellBack, message }
  }
  return { ok, channel: 'thunder', fellBack: false, message: ok ? '已添加到迅雷任务列表' : '迅雷下载失败' }
}
