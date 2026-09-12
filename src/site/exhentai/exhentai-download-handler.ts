import dayjs, { type Dayjs } from 'dayjs'
import { fetchTorrentsFromDownloadPage, type TorrentEntry } from './exhentai-api'
import { download } from '@/download'
import {
  getHentaiArchivesMapByHash,
  upsertHentaiArchive,
  HentaiArchiveStatus,
  type HentaiArchiveDto
} from '@/dao/hentai-archive'
import { ElNotification } from 'element-plus'
import { ExhentaiUtils } from './exhentai-utils'

/** 下载流程的结果类型 */
export type DownloadOutcomeKind =
  | 'latest' // 命中最新种子并已提交下载
  | 'downloaded' // 从过时种子里挑选并已提交下载（归档记为 304）
  | 'no-newer-seed' // 过时种子不比归档新，已标记 304（未下载）
  | 'no-href' // 缺少 data-orig-href
  | 'fetch-error' // 请求下载页失败 / 抛出异常
  | 'no-outdated' // 无过时种子
  | 'dom-missing' // 队列专用：条目已不在 DOM
  | 'no-download-button' // 队列专用：找不到下载按钮

export interface DownloadOutcome {
  /** 流程是否正常走完（含 no-newer-seed）；false 表示硬错误 */
  ok: boolean
  /** 是否调用过 download()（仅代表已提交，不代表文件真的下载成功） */
  downloaded: boolean
  kind: DownloadOutcomeKind
  message: string
}

export class ExhentaiDownloadHandler {
  private $download: JQuery
  private index: number
  private gid: string
  private date: Dayjs
  private title: string
  private titleHash?: string
  /**
   * 该标题 hash 下的归档记录（列表页已批量查过，含 200/304/400）。
   * undefined = 调用方未注入 → 判重时回退查库；[] = 查过但没有记录（有效值，不再查库）
   */
  private archives?: HentaiArchiveDto[]
  private silent: boolean

  constructor(
    $download: JQuery,
    index: number,
    gid: string,
    date: Dayjs,
    title: string = '',
    titleHash?: string,
    archives?: HentaiArchiveDto[],
    silent = false
  ) {
    this.$download = $download
    this.index = index
    this.gid = gid
    this.date = date
    this.title = title
    this.titleHash = titleHash
    this.archives = archives
    this.silent = silent
  }

  /** 统一通知出口；队列批量执行时静默，避免刷屏 */
  private notify(message: string, type: 'success' | 'warning' | 'info' | 'error' = 'info'): void {
    if (this.silent) return
    ElNotification({ title: '提示', message, type })
  }

  /** 同一画廊同一时刻只允许一条执行链（手动点击 vs 队列） */
  private acquireLock(): boolean {
    if (this.$download.attr('data-mansion-lock') === '1') return false
    this.$download.attr('data-mansion-lock', '1')
    return true
  }

  private releaseLock(): void {
    try {
      this.$download.removeAttr('data-mansion-lock')
    } catch {
      // 忽略 DOM 操作错误
    }
  }

  /** 完整执行"点击一次"的全部逻辑，返回结构化结果供队列消费 */
  public async execute(): Promise<DownloadOutcome> {
    if (!this.acquireLock()) {
      this.notify('该画廊正在处理中，请稍候', 'warning')
      return { ok: false, downloaded: false, kind: 'fetch-error', message: '该画廊正在处理中' }
    }

    try {
      console.log('exhentai download execute', this.index, this.gid)

      const downloadHref = this.$download.attr('data-orig-href') || this.$download.data('orig-href')
      if (!downloadHref) {
        console.warn('exhentai: 没有找到原始下载链接 (data-orig-href)')
        this.notify('未找到下载链接', 'error')
        return { ok: false, downloaded: false, kind: 'no-href', message: '未找到下载链接' }
      }

      const res = await fetchTorrentsFromDownloadPage(downloadHref)
      if (res.error) {
        console.warn('exhentai fetch error', res.error)
        this.notify('请求下载页面失败', 'error')
        return { ok: false, downloaded: false, kind: 'fetch-error', message: res.error }
      }

      // 有最新的种子，直接下载
      if (res.latest) {
        await this.handleLatestTorrent(res.latest)
        return { ok: true, downloaded: true, kind: 'latest', message: '已提交最新种子' }
      }

      // 处理过时种子
      return await this.handleOutdatedTorrents(res.outdated)
    } catch (err) {
      console.error(err)
      this.notify('请求下载页面失败', 'error')
      return {
        ok: false,
        downloaded: false,
        kind: 'fetch-error',
        message: err instanceof Error ? err.message : String(err)
      }
    } finally {
      this.releaseLock()
    }
  }

  /** 兼容现有的手动点击绑定，行为与改造前一致 */
  public createHandler() {
    return async () => {
      await this.execute()
    }
  }

  private async handleLatestTorrent(latest: TorrentEntry): Promise<void> {
    download(latest.href)
    try {
      await upsertHentaiArchive(Number(this.gid), this.date.toDate(), HentaiArchiveStatus.DownloadSuccess, this.title)
      this.tryHideDownloadButton()
    } catch (err) {
      console.warn('exhentai: upsertHentaiArchive failed', err)
    }
  }

  /** 统一隐藏下载按钮 */
  private tryHideDownloadButton(): void {
    try {
      this.$download.hide()
    } catch {
      // 忽略 DOM 操作错误
    }
  }

  /** 下载种子并写入归档记录 */
  private async downloadAndArchive(entry: TorrentEntry, status: HentaiArchiveStatus): Promise<void> {
    download(entry.href)
    // 解析失败时回退页面画廊日期：该日期同时是判重水位线（见 resolveArchive），
    // 宁可偏高（少下载）也不能归零，否则每次进页面都会判为"有更新"而重复下载
    const date = entry.parsedDate?.toDate() || this.date.toDate()
    await upsertHentaiArchive(Number(this.gid), date, status, this.title)
    // 与下次进页面时 304 条目的呈现保持一致：置灰而非隐藏
    this.applyArchiveStyle()
  }

  /** 置灰下载按钮（304 语义的统一呈现） */
  private applyArchiveStyle(): void {
    try {
      ExhentaiUtils.applyArchiveStyle(this.$download)
    } catch {
      // 忽略 DOM 操作错误
    }
  }

  /** 解析过时种子的日期文本 */
  private parseOutdatedDates(outdated: TorrentEntry[]): void {
    for (const entry of outdated) {
      if (!entry.parsedDate) {
        const parsed = ExhentaiUtils.parseDateText(entry.dateText)
        if (parsed) {
          entry.parsedDate = parsed
        }
      }
    }
  }

  /** 从归档记录中提取 Dayjs 日期 */
  private getArchiveDayjs(archive: HentaiArchiveDto): Dayjs | null {
    if (!archive.date) return null
    const d = dayjs(archive.date)
    return d.isValid() ? d : null
  }

  /**
   * 从归档记录中挑出"已处理过"的一条：200（已下载）/ 304（无更新）都算已处理，排除 400（用户跳过）。
   * 取 date 最大的一条作为判重水位线——因为 304 记录的 date 写的就是种子日期，
   * 所以"最新过时种子 > 水位线"即等价于"出现了尚未处理过的新种子"。
   *
   * 用 max(date) 而非 max(created_time)：markAsNoNewerSeed 的写入守卫保证 304 行的 date
   * 不会超过对应 200 行的 date，因此与旧实现（只查 200）的判定结果一致，对既有画廊零行为变更。
   */
  private resolveArchive(archives?: HentaiArchiveDto[]): HentaiArchiveDto | null {
    if (!archives || archives.length === 0) return null
    const processed = archives.filter(
      (a) => a.status === HentaiArchiveStatus.DownloadSuccess || a.status === HentaiArchiveStatus.NoNewerSeed
    )
    if (processed.length === 0) return null
    return processed.reduce((latest, current) => (current.date.getTime() > latest.date.getTime() ? current : latest))
  }

  /** 无存档记录时：直接下载最近的过时种子，归档记为 304（下的是过时种子，保留复查） */
  private async handleNoArchive(entry: TorrentEntry): Promise<void> {
    await this.downloadAndArchive(entry, HentaiArchiveStatus.NoNewerSeed)
    this.notify('未找到下载记录，已提交最近的过时种子', 'info')
  }

  /** 有存档记录时：比较日期，若更新则下载，归档记为 304 */
  private async handleExistingArchive(archive: HentaiArchiveDto, entry: TorrentEntry): Promise<boolean> {
    const archiveDayjs = this.getArchiveDayjs(archive)
    const outdatedDate = entry.parsedDate

    if (outdatedDate && archiveDayjs?.isValid() && outdatedDate.isAfter(archiveDayjs)) {
      await this.downloadAndArchive(entry, HentaiArchiveStatus.NoNewerSeed)
      this.notify('已提交更新的过时种子', 'info')
      return true
    }
    return false
  }

  /** 标记为无更新种子 */
  private async markAsNoNewerSeed(entry: TorrentEntry): Promise<void> {
    const outdatedDate = entry.parsedDate
    if (outdatedDate) {
      await upsertHentaiArchive(Number(this.gid), outdatedDate.toDate(), HentaiArchiveStatus.NoNewerSeed, this.title)
    }
    this.applyArchiveStyle()
  }

  private async handleOutdatedTorrents(outdated: TorrentEntry[]): Promise<DownloadOutcome> {
    if (outdated.length === 0) {
      this.notify('未找到下载链接', 'error')
      return { ok: false, downloaded: false, kind: 'no-outdated', message: '未找到过时种子' }
    }

    // 解析日期并排序
    this.parseOutdatedDates(outdated)
    const sortedOutdated = this.sortOutdatedByDate(outdated)
    const mostRecent = sortedOutdated[0]

    if (!mostRecent) {
      this.notify('未找到下载链接', 'error')
      return { ok: false, downloaded: false, kind: 'no-outdated', message: '未找到过时种子' }
    }

    // 判重决策：一律按标题 hash（gid 会随画廊更新/重传变动，不作判重依据；title/title_hash 已强制非空，无 gid 回退）
    // 数据优先用列表页注入的缓存（同一批查询结果，不再逐条查库）；仅在未注入时才回退查询
    try {
      let archiveList = this.archives
      if (archiveList === undefined && this.titleHash) {
        archiveList = (await getHentaiArchivesMapByHash([this.titleHash]))[this.titleHash]
      }
      const archive = this.resolveArchive(archiveList)

      if (archive) {
        const downloaded = await this.handleExistingArchive(archive, mostRecent)
        if (downloaded) {
          return { ok: true, downloaded: true, kind: 'downloaded', message: '已提交更新的过时种子' }
        }
      } else {
        await this.handleNoArchive(mostRecent)
        return {
          ok: true,
          downloaded: true,
          kind: 'downloaded',
          message: '未找到下载记录，已提交最近的过时种子'
        }
      }
    } catch (err) {
      console.warn('exhentai: getHentaiArchivesMapByHash failed', err)
    }

    // 过时种子不比归档新，标记为无新种子
    this.notify('没有最新的种子', 'info')
    try {
      await this.markAsNoNewerSeed(mostRecent)
    } catch (err) {
      console.warn('exhentai: upsertHentaiArchive failed', err)
    }
    return { ok: true, downloaded: false, kind: 'no-newer-seed', message: '没有更新的种子' }
  }

  private sortOutdatedByDate(outdated: TorrentEntry[]): TorrentEntry[] {
    return [...outdated].sort((a, b) => {
      const dateA = a.parsedDate
      const dateB = b.parsedDate
      // 如果日期无效，放到数组末尾
      if (!dateA) return 1
      if (!dateB) return -1
      // 从新到旧排序（降序）
      return dateB.valueOf() - dateA.valueOf()
    })
  }
}
