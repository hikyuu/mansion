import type { Dayjs } from 'dayjs'
import { fetchTorrentsFromDownloadPage, type TorrentEntry } from './exhentai-api'
import { download } from '@/download'
import { getDownloadedArchivesMap, upsertHentaiArchive, HentaiArchiveStatus } from '@/dao/hentai-archive'
import { ElNotification } from 'element-plus'
import { ExhentaiUtils } from './exhentai-utils'

export class ExhentaiDownloadHandler {
  private $download: JQuery
  private index: number
  private gid: string
  private date: Dayjs

  constructor($download: JQuery, index: number, gid: string, date: Dayjs) {
    this.$download = $download
    this.index = index
    this.gid = gid
    this.date = date
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
      await upsertHentaiArchive(Number(this.gid), this.date.toDate(), HentaiArchiveStatus.DownloadSuccess)
      try {
        this.$download.hide()
      } catch {
        // 忽略 DOM 操作错误
      }
    } catch (err) {
      console.warn('exhentai: upsertHentaiArchive failed', err)
    }
  }

  private async handleOutdatedTorrents(outdated: TorrentEntry[]): Promise<void> {
    if (outdated.length === 0) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 将outdated中的dateText全部转为dayjs,后续不用重复转换
    outdated.forEach((entry) => {
      if (!entry.parsedDate) {
        const parsed = ExhentaiUtils.parseDateText(entry.dateText)
        if (parsed) {
          entry.parsedDate = parsed
        }
      }
    })

    // 对 outdated 数组按日期从新到旧排序（使用缓存的parsedDate）
    const sortedOutdated = this.sortOutdatedByDate(outdated)

    // 取最近的过时种子（数组第一个即最近）
    const mostRecentOutdated = sortedOutdated[0]

    if (!mostRecentOutdated) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 查询 hentai-archive 是否有下载记录
    try {
      const archivesMap = await getDownloadedArchivesMap([Number(this.gid)])
      const archives = archivesMap[Number(this.gid)]
      const archive = archives && archives.length > 0 ? archives[0] : null

      if (archive) {
        // 比较日期：如果最近的过时种子比归档记录更新，则下载
        const archiveDate = archive.date ? (typeof archive.date === 'string' ? archive.date : '') : ''
        const archiveDayjs = archiveDate ? ExhentaiUtils.parseDateText(archiveDate) : null
        const outdatedDate = mostRecentOutdated.parsedDate

        if (outdatedDate && archiveDayjs && archiveDayjs.isValid() && outdatedDate.isAfter(archiveDayjs)) {
          // 过时种子比归档记录新，下载并使用过时种子的日期更新归档
          download(mostRecentOutdated.href)
          await upsertHentaiArchive(Number(this.gid), outdatedDate.toDate(), HentaiArchiveStatus.DownloadSuccess)
          ElNotification({ title: '提示', message: '下载最近的过时种子完成', type: 'info' })
          try {
            this.$download.hide()
          } catch {
            // 忽略 DOM 操作错误
          }
          return
        }
      } else {
        // 没有存档记录，直接下载最近的过时种子，使用过时种子的日期
        download(mostRecentOutdated.href)
        ElNotification({ title: '提示', message: '未找到下载记录，下载最近的过时种子', type: 'info' })
        await upsertHentaiArchive(
          Number(this.gid),
          mostRecentOutdated.parsedDate?.toDate() || this.date.toDate(),
          HentaiArchiveStatus.DownloadSuccess
        )
        try {
          this.$download.hide()
        } catch {
          // 忽略 DOM 操作错误
        }
        return
      }
    } catch (err) {
      console.warn('exhentai: getDownloadedArchivesMap failed', err)
    }

    // 过时种子不比归档新，标记为无新种子
    ElNotification({ title: '提示', message: '没有最新的种子', type: 'info' })
    try {
      // 使用最近过时种子的日期进行归档（使用缓存的parsedDate）
      const outdatedDate = mostRecentOutdated.parsedDate
      if (outdatedDate) {
        await upsertHentaiArchive(Number(this.gid), outdatedDate.toDate(), HentaiArchiveStatus.NoNewerSeed)
      }
      try {
        ExhentaiUtils.applyArchiveStyle(this.$download)
      } catch {
        // 忽略 DOM 操作错误
      }
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
