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

export class ExhentaiDownloadHandler {
  private $download: JQuery
  private index: number
  private gid: string
  private date: Dayjs
  private title: string
  private titleHash?: string

  constructor(
    $download: JQuery,
    index: number,
    gid: string,
    date: Dayjs,
    title: string = '',
    titleHash?: string
  ) {
    this.$download = $download
    this.index = index
    this.gid = gid
    this.date = date
    this.title = title
    this.titleHash = titleHash
  }

  public createHandler() {
    return async () => {
      console.log('exhentai download clicked', this.index, this.gid)

      const downloadHref = this.$download.attr('data-orig-href') || this.$download.data('orig-href')
      if (!downloadHref) {
        console.warn('exhentai: 没有找到原始下载链接 (data-orig-href)')
        ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
        return
      }

      try {
        const res = await fetchTorrentsFromDownloadPage(downloadHref)
        if (res.error) {
          console.warn('exhentai fetch error', res.error)
          ElNotification({ title: '提示', message: '请求下载页面失败', type: 'error' })
          return
        }

        // 有最新的种子，直接下载
        if (res.latest) {
          await this.handleLatestTorrent(res.latest)
          return
        }

        // 处理过时种子
        await this.handleOutdatedTorrents(res.outdated)
      } catch (err) {
        console.error(err)
        ElNotification({ title: '提示', message: '请求下载页面失败', type: 'error' })
      }
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
    const date = entry.parsedDate?.toDate() || this.date.toDate()
    await upsertHentaiArchive(Number(this.gid), date, status, this.title)
    this.tryHideDownloadButton()
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

  /** 无存档记录时：直接下载最近的过时种子 */
  private async handleNoArchive(entry: TorrentEntry): Promise<void> {
    await this.downloadAndArchive(entry, HentaiArchiveStatus.DownloadSuccess)
    ElNotification({ title: '提示', message: '未找到下载记录，下载最近的过时种子', type: 'info' })
  }

  /** 有存档记录时：比较日期，若更新则下载 */
  private async handleExistingArchive(archive: HentaiArchiveDto, entry: TorrentEntry): Promise<boolean> {
    const archiveDayjs = this.getArchiveDayjs(archive)
    const outdatedDate = entry.parsedDate

    if (outdatedDate && archiveDayjs?.isValid() && outdatedDate.isAfter(archiveDayjs)) {
      await this.downloadAndArchive(entry, HentaiArchiveStatus.DownloadSuccess)
      ElNotification({ title: '提示', message: '下载最近的过时种子完成', type: 'info' })
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
    try {
      ExhentaiUtils.applyArchiveStyle(this.$download)
    } catch {
      // 忽略 DOM 操作错误
    }
  }

  private async handleOutdatedTorrents(outdated: TorrentEntry[]): Promise<void> {
    if (outdated.length === 0) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 解析日期并排序
    this.parseOutdatedDates(outdated)
    const sortedOutdated = this.sortOutdatedByDate(outdated)
    const mostRecent = sortedOutdated[0]

    if (!mostRecent) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 查询归档记录并决策：一律按标题 hash 判重（gid 会随画廊更新/重传变动，不作判重依据；title/title_hash 已强制非空，无 gid 回退）
    try {
      let archive: HentaiArchiveDto | null = null
      if (this.titleHash) {
        const archives = (await getHentaiArchivesMapByHash([this.titleHash], HentaiArchiveStatus.DownloadSuccess))[
          this.titleHash
        ]
        archive = archives && archives.length > 0 ? archives[0] : null
      }

      if (archive) {
        const downloaded = await this.handleExistingArchive(archive, mostRecent)
        if (downloaded) return
      } else {
        await this.handleNoArchive(mostRecent)
        return
      }
    } catch (err) {
      console.warn('exhentai: getHentaiArchivesMapByHash failed', err)
    }

    // 过时种子不比归档新，标记为无新种子
    ElNotification({ title: '提示', message: '没有最新的种子', type: 'info' })
    try {
      await this.markAsNoNewerSeed(mostRecent)
    } catch (err) {
      console.warn('exhentai: upsertHentaiArchive failed', err)
    }
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
