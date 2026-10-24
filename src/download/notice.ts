import { ElNotification } from 'element-plus'
import type { DownloadSubmitResult } from '@/download'

/**
 * 下载地址的来源。
 * `label` 进入通知正文，`note` 承载「为什么没用首选来源」这类补充信息
 * （如 onejav 回退时的「javdb 未命中：没有找到高分磁力链接」）。
 */
export interface DownloadSource {
  label: string
  note?: string
}

export interface DownloadNoticeInput {
  /** 通知标题：番号；没有番号的场景（exhentai 画廊）用画廊标题 */
  title: string
  source?: DownloadSource
  result: DownloadSubmitResult
}

export interface DownloadNotice {
  type: 'success' | 'warning' | 'error' | 'info'
  message: string
}

export const CHANNEL_LABELS: Record<DownloadSubmitResult['channel'], string> = {
  miao: 'miao',
  thunder: '迅雷',
  copy: '剪贴板'
}

/** 来源文案：`javdb 高分磁力（javdb 未命中：没有找到磁力链接）` */
export function formatDownloadSource(source?: DownloadSource): string {
  if (!source) return '未知来源'
  return source.note ? `${source.label}（${source.note}）` : source.label
}

/** 通道文案：回退时带上 miao 侧原因，如 `迅雷（miao 回退：无法连接 miao 服务）` */
export function formatDownloadChannel(result: DownloadSubmitResult): string {
  const label = CHANNEL_LABELS[result.channel] ?? result.channel
  if (!result.fellBack) return label
  return result.fallbackReason ? `${label}（miao 回退：${result.fallbackReason}）` : `${label}（miao 回退）`
}

/** 结局 → 通知类型：成功 success、回退 warning、用户取消 info、其余 error */
export function resolveNoticeType(result: DownloadSubmitResult): DownloadNotice['type'] {
  if (result.outcome === 'cancelled') return 'info'
  if (!result.ok) return 'error'
  return result.fellBack ? 'warning' : 'success'
}

/** 纯格式化：`来源 → 通道：结局` */
export function formatDownloadNotice(input: DownloadNoticeInput): DownloadNotice {
  return {
    type: resolveNoticeType(input.result),
    message: `${formatDownloadSource(input.source)} → ${formatDownloadChannel(input.result)}：${input.result.message}`
  }
}

/** 下载通知的唯一出口：标题固定由调用方给（番号 / 画廊标题） */
export function notifyDownload(input: DownloadNoticeInput): void {
  const { type, message } = formatDownloadNotice(input)
  ElNotification({ title: input.title, message, type })
}
