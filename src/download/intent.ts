import { readonly, ref } from 'vue'
import { ElNotification } from 'element-plus'
import { download, type DownloadSubmitResult } from '@/download'
import { notifyDownload, type DownloadSource } from '@/download/notice.ts'
import { haveArchived, upsertArchive } from '@/dao/archive'

/** 下载意图的四态结局 */
export type DownloadIntentStatus =
  /** 同一番号的意图还在途，本次被守卫拦下 */
  | 'blocked'
  /** 判档命中，不再重复交付 */
  | 'skipped'
  /** 已提交给下载通道（不代表文件已落盘） */
  | 'submitted'
  /** 未选中 / 解析失败 / 提交失败 */
  | 'failed'

export interface DownloadIntentResult {
  status: DownloadIntentStatus
  message: string
  /** 仅 submitted：透传下载通道的结局 */
  submit?: DownloadSubmitResult
}

/** 站点解析出的下载地址与来源（来源进通知正文，如「javdb 高分磁力」「onejav 种子」） */
export interface ResolvedDownloadSource {
  url: string
  source: DownloadSource
}

export interface SubmitDownloadInput {
  /** 当前选中番号；为空即 failed（提示「没有选中」） */
  serialNumber?: string
  /** 是否判档；键盘 Alt 按下时传 false */
  checkArchive: boolean
  /** 站点的「番号 → 下载地址」解析器：null = 没有可下载地址，抛错 = 意外失败 */
  resolveSource: () => Promise<ResolvedDownloadSource | null>
}

/** 在途守卫：番号集合 + 给 UI 的快照数组（Set 直接进响应式不稳，故用数组快照） */
const inFlight = new Set<string>()
const inFlightList = ref<string[]>([])

/** 在途的番号，供下载列表展示（只读） */
export const activeDownloads = readonly(inFlightList)

function markInFlight(key: string): void {
  inFlight.add(key)
  inFlightList.value = [...inFlight]
}

function unmarkInFlight(key: string): void {
  inFlight.delete(key)
  inFlightList.value = [...inFlight]
}

/** 通知标题：番号；没有选中的场景退化为「下载」 */
function notify(
  serialNumber: string | undefined,
  message: string,
  type: 'info' | 'warning' | 'error' = 'info'
): void {
  ElNotification({ title: serialNumber || '下载', message, type })
}

/** 判档失败不应阻塞下载：按「未归档」继续，并留下诊断日志 */
async function isArchived(serialNumber: string): Promise<boolean> {
  try {
    return await haveArchived(serialNumber)
  } catch (error) {
    console.warn('[intent] 判档失败，按未归档继续', { serialNumber, error })
    return false
  }
}

/**
 * 下载意图：选中判空 → 在途守卫 → 判档 → 解析下载地址 → 提交 → 交付判定 → 记账。
 *
 * 记账口径见 CONTEXT.md「交付」：只有提交给下载通道且不是 copy（复制的成功是乐观值）才写归档。
 * 通知统一在此处出口：标题固定为番号，正文为「来源 → 通道：结局」，
 * 通道层不再自己弹，保证一次下载只有一条结果通知。
 * 永不 reject —— 结局统一由 DownloadIntentResult 表达。
 */
export async function submitDownload(input: SubmitDownloadInput): Promise<DownloadIntentResult> {
  const serialNumber = input.serialNumber?.trim()
  if (!serialNumber) {
    notify(undefined, '没有选中')
    return { status: 'failed', message: '没有选中' }
  }

  if (inFlight.has(serialNumber)) {
    notify(serialNumber, '正在下载中')
    return { status: 'blocked', message: '正在下载中' }
  }

  markInFlight(serialNumber)
  try {
    if (input.checkArchive && (await isArchived(serialNumber))) {
      notify(serialNumber, '已经归档')
      return { status: 'skipped', message: '已经归档' }
    }

    let resolved: ResolvedDownloadSource | null
    try {
      resolved = await input.resolveSource()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[intent] 解析下载地址失败', { serialNumber, error })
      notify(serialNumber, message ? `解析下载地址失败：${message}` : '解析下载地址失败', 'error')
      return { status: 'failed', message }
    }

    if (!resolved) {
      notify(serialNumber, '没有找到下载地址', 'warning')
      return { status: 'failed', message: '没有找到下载地址' }
    }

    const submit = await download(resolved.url)
    notifyDownload({ title: serialNumber, source: resolved.source, result: submit })
    if (!submit.ok) {
      return { status: 'failed', message: submit.message, submit }
    }

    if (submit.channel !== 'copy') {
      try {
        await upsertArchive(serialNumber)
      } catch (error) {
        // 已交付但记账失败：不影响本次提交，下次进页面会重新判档
        console.warn('[intent] 归档写入失败', { serialNumber, error })
      }
    }
    return { status: 'submitted', message: submit.message, submit }
  } finally {
    unmarkInFlight(serialNumber)
  }
}
