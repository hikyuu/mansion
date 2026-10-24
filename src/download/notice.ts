import { h, type VNode } from 'vue'
import { ElNotification } from 'element-plus'
import type { DownloadSubmitResult } from '@/download'
import '@/styles/download-notice.css'

/** 来源身份：决定徽章配色，便于连续下载时一眼分清是哪个站点给的地址 */
export type DownloadOrigin = 'javdb' | 'onejav' | 'exhentai' | 'unknown'

/**
 * 下载地址的来源。
 * `label` 进入通知正文，`note` 承载「为什么没用首选来源」这类补充信息
 * （如 onejav 回退时的「javdb 未命中：没有找到高分磁力链接」）。
 * `origin` 显式声明来源身份；缺省时按 label 前缀推断，旧调用点不用改。
 */
export interface DownloadSource {
  label: string
  note?: string
  origin?: DownloadOrigin
}

export interface DownloadNoticeInput {
  /** 通知标题：番号；没有番号的场景（exhentai 画廊）用画廊标题 */
  title: string
  source?: DownloadSource
  result: DownloadSubmitResult
}

export type DownloadNoticeType = 'success' | 'warning' | 'error' | 'info'

export interface DownloadNotice {
  type: DownloadNoticeType
  message: string
}

/** 通知的渲染模型：四层结构，VNode 与纯文本共用同一份数据 */
export interface DownloadNoticeModel {
  title: string
  type: DownloadNoticeType
  /** 状态词：已投递 / 已回退 / 已取消 / 失败 */
  statusText: string
  /** 未开始投递的告警（没选中 / 已归档 / 解析失败）没有「来源 → 通道」 */
  source?: string
  sourceOrigin?: DownloadOrigin
  channel?: string
  /** 诊断行：来源侧的未命中原因、通道侧的回退原因 */
  notes: string[]
  outcome: string
}

/** 意图层的前置结局：没有通道参与，但沿用同一张回执的排版 */
export interface DownloadIntentNoticeInput {
  title: string
  type: DownloadNoticeType
  statusText: string
  detail: string
  notes?: string[]
}

export const CHANNEL_LABELS: Record<DownloadSubmitResult['channel'], string> = {
  miao: 'miao',
  thunder: '迅雷',
  copy: '剪贴板'
}

/** 状态词是颜色之外的第二重信号，不能只靠颜色区分四态 */
const STATUS_TEXT: Record<DownloadNoticeType, string> = {
  success: '已投递',
  warning: '已回退',
  error: '失败',
  info: '已取消'
}

/** 停留时长按严重度分档：失败要留够读原因的时间，成功则尽快让位给下一条 */
const NOTICE_DURATION: Record<DownloadNoticeType, number> = {
  success: 3200,
  warning: 6000,
  error: 8000,
  info: 3200
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
export function resolveNoticeType(result: DownloadSubmitResult): DownloadNoticeType {
  if (result.outcome === 'cancelled') return 'info'
  if (!result.ok) return 'error'
  return result.fellBack ? 'warning' : 'success'
}

/** 来源身份推断：显式 `origin` 优先，缺省时按 label 里的站点名兜底 */
export function inferDownloadOrigin(label: string): DownloadOrigin {
  const normalized = label.toLowerCase()
  if (normalized.includes('javdb')) return 'javdb'
  if (normalized.includes('onejav')) return 'onejav'
  if (normalized.includes('exhentai')) return 'exhentai'
  return 'unknown'
}

/** 纯文本口径：日志、测试与「来源 → 通道：结局」的一行摘要 */
export function formatDownloadNotice(input: DownloadNoticeInput): DownloadNotice {
  return {
    type: resolveNoticeType(input.result),
    message: `${formatDownloadSource(input.source)} → ${formatDownloadChannel(input.result)}：${input.result.message}`
  }
}

/** 结构化口径：把同一份数据拆成四层，供 VNode 渲染 */
export function buildDownloadNoticeModel(input: DownloadNoticeInput): DownloadNoticeModel {
  const type = resolveNoticeType(input.result)
  const notes: string[] = []
  if (input.source?.note) notes.push(input.source.note)
  if (input.result.fellBack) {
    notes.push(input.result.fallbackReason ? `miao 回退：${input.result.fallbackReason}` : 'miao 回退')
  }
  return {
    title: input.title,
    type,
    statusText: STATUS_TEXT[type],
    source: input.source?.label ?? '未知来源',
    sourceOrigin: input.source ? (input.source.origin ?? inferDownloadOrigin(input.source.label)) : 'unknown',
    channel: CHANNEL_LABELS[input.result.channel] ?? input.result.channel,
    notes,
    outcome: input.result.message
  }
}

/**
 * 渲染一张「运单回执」：
 * 番号 + 状态词 / hairline / 字段表（来源、通道、结果、备注）。
 * 字段表用 label 列建立扫读锚点，通道名是唯一的徽章式强调。
 * 全部走 VNode 文本节点，外部文案（番号、javdb 原因、miao 返回）不会被当成 HTML 解析。
 */
export function renderDownloadNotice(model: DownloadNoticeModel): VNode {
  const fields: VNode[] = []

  if (model.source) {
    fields.push(
      h('span', { class: 'mansion-dn__label' }, '来源'),
      h('span', { class: 'mansion-dn__value' }, [
        h(
          'span',
          { class: `mansion-dn__source mansion-dn__origin--${model.sourceOrigin ?? 'unknown'}` },
          model.source
        )
      ])
    )
  }

  if (model.channel) {
    fields.push(
      h('span', { class: 'mansion-dn__label' }, '通道'),
      h('span', { class: 'mansion-dn__value mansion-dn__channel' }, model.channel)
    )
  }

  fields.push(
    h('span', { class: 'mansion-dn__label' }, '结果'),
    h('span', { class: 'mansion-dn__value mansion-dn__outcome' }, model.outcome)
  )

  if (model.notes.length > 0) {
    fields.push(
      h('span', { class: 'mansion-dn__label' }, '备注'),
      h(
        'span',
        { class: 'mansion-dn__value mansion-dn__notes' },
        model.notes.map((note) => h('span', { class: 'mansion-dn__note' }, note))
      )
    )
  }

  return h('div', { class: 'mansion-dn__body' }, [
    h('div', { class: 'mansion-dn__head' }, [
      h('span', { class: 'mansion-dn__serial' }, model.title),
      h('span', { class: 'mansion-dn__status' }, [h('i', { class: 'mansion-dn__dot' }), model.statusText])
    ]),
    h('div', { class: 'mansion-dn__rule' }),
    h('div', { class: 'mansion-dn__fields' }, fields)
  ])
}

/** 所有下载通知的唯一出口：标题固定由调用方给（番号 / 画廊标题），四态各自配色与停留时长 */
function notifyModel(model: DownloadNoticeModel): void {
  ElNotification({
    customClass: `mansion-dn mansion-dn--${model.type}`,
    message: () => renderDownloadNotice(model),
    duration: NOTICE_DURATION[model.type],
    showClose: true
  })
}

/** 投递回执：来源 → 通道 → 结局 */
export function notifyDownload(input: DownloadNoticeInput): void {
  notifyModel(buildDownloadNoticeModel(input))
}

/**
 * 意图层的前置结局（没选中 / 在途 / 已归档 / 解析失败 / 无地址）。
 * 没有通道参与，省掉路径行，但标题、hairline、诊断行与结局沿用同一套版式。
 */
export function notifyIntent(input: DownloadIntentNoticeInput): void {
  notifyModel({
    title: input.title,
    type: input.type,
    statusText: input.statusText,
    notes: input.notes ?? [],
    outcome: input.detail
  })
}
