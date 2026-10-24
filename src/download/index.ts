import { thunderDownload } from '@/download/thunder.ts'
import { copyUrl } from '@/download/clipboard.ts'
import { miaoDownload } from '@/download/miao.ts'
import { useConfigStore, type DownloadMethod } from '@/store/config-store.ts'

export type { DownloadMethod } from '@/store/config-store.ts'

/** 通道侧结局：created=已建任务、cancelled=用户取消、failed=未交付 */
export type DownloadOutcome = 'created' | 'cancelled' | 'failed'

export interface DownloadSubmitResult {
  /** 是否真实提交成功（miao 已建任务 / 迅雷协议调用未抛错 / 复制已完成） */
  ok: boolean
  channel: DownloadMethod
  /** 是否走了「miao 优先失败回退迅雷」的回退 */
  fellBack: boolean
  /** 仅 fellBack：miao 侧的回退原因，供通知展示 */
  fallbackReason?: string
  outcome: DownloadOutcome
  /** 通道侧文案：不含来源与通道前缀，由通知层拼「来源 → 通道：结局」 */
  message: string
}

/**
 * 下载分发入口：miao 优先（默认，失败回退迅雷协议）/ 迅雷协议 / 复制链接。
 * 内部永不 reject，结局统一由 DownloadSubmitResult 表达；通道本身不发通知，
 * 这样标题才能统一成番号（通道层拿不到番号）。
 */
export async function download(url: string): Promise<DownloadSubmitResult> {
  let method: DownloadMethod = 'miao'
  try {
    method = useConfigStore().getSiteConfig.downloadMethod
    switch (method) {
      case 'thunder':
        return submitThunder(url)
      case 'copy': {
        const copied = await copyUrl(url)
        return {
          ok: copied.ok,
          channel: 'copy',
          fellBack: false,
          outcome: copied.ok ? 'created' : 'failed',
          message: copied.message
        }
      }
      default:
        return await submitMiao(url)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, channel: method, fellBack: false, outcome: 'failed', message }
  }
}

/** miao 优先：失败或 URL 不支持时回退迅雷 */
async function submitMiao(url: string): Promise<DownloadSubmitResult> {
  const attempt = await miaoDownload(url)
  if (attempt.status === 'created') {
    return { ok: true, channel: 'miao', fellBack: false, outcome: 'created', message: attempt.message }
  }
  if (attempt.status === 'cancelled') {
    return { ok: false, channel: 'miao', fellBack: false, outcome: 'cancelled', message: attempt.message }
  }
  return submitThunder(url, attempt.message)
}

/** 迅雷协议提交：回退时保留 miao 侧原因，通知统一由下载意图层出 */
function submitThunder(url: string, fallbackReason?: string): DownloadSubmitResult {
  const ok = thunderDownload(url)
  const fellBack = fallbackReason !== undefined
  if (fellBack) console.warn('[download] 回退迅雷', { url, ok, reason: fallbackReason })
  return {
    ok,
    channel: 'thunder',
    fellBack,
    ...(fallbackReason ? { fallbackReason } : {}),
    outcome: ok ? 'created' : 'failed',
    message: ok ? '已添加任务' : '迅雷协议建任务失败'
  }
}
