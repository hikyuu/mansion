import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import type { Info } from '@/store/sister-store'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import dayjs, { type Dayjs } from 'dayjs'
import { fetchFirstTorrentFromDownloadPage, type TorrentEntry } from './exhentai-api'
import { ElNotification } from 'element-plus'
import { download } from '@/download'
import { getHentaiArchivesMap, getDownloadedArchivesMap, upsertHentaiArchive, HentaiArchiveStatus, type HentaiArchiveDto } from '@/dao/hentai-archive'
import { FORMAT } from '@/dictionary'

type ItemInfo = {
  index: number
  $item: JQuery
  gid?: string
  $download?: JQuery
  date?: Dayjs
}

export class Exhentai extends SiteAbstract {
  waterfall: waterfall

  public name = 'exhentai'
  public siteId = SiteId.EXHENTAI

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.gl1t',
    container: 'div.itg.gld',
    pagination: '',
    serialNumber: 'a:has(.gl4t.glname.glink)',
    link: 'div.gl5t .gldown a',
    date: 'div.gl5t [id^="posted_"]'
  } as Selector
  theme = {
    PRIMARY_COLOR: '#00d1b2',
    SECONDARY_COLOR: '#e3f5f3',
    WARNING_COLOR: '#fadd65'
  }
  constructor() {
    super()
    this.waterfall = new waterfall(this, this.selector)
  }

  private extractGidFromGalleryLink($item: JQuery): string | undefined {
    const $galleryLink = $item.find(this.selector.serialNumber).first()
    const galleryHref = $galleryLink.attr('href')
    if (!galleryHref) return undefined
    const m = galleryHref.match(/\/g\/(\d+)(?:\/|$)/i)
    if (m && m[1]) {
      return m[1]
    }
    try {
      const u = new URL(galleryHref, location.href)
      const parts = u.pathname.split('/').filter(Boolean)
      const gIndex = parts.indexOf('g')
      if (gIndex >= 0 && parts.length > gIndex + 1) return parts[gIndex + 1]
    } catch (e) {
      // ignore
    }
    return undefined
  }

  private parseItemDate($item: JQuery): Dayjs | undefined {
    const $d = $item.find(this.selector.date).first()
    if ($d.length === 0) return undefined
    const txt = ($d.attr('title') || $d.text() || '').trim()
    if (!txt) return undefined
    // 使用字典中定义的格式解析
    const parsed = this.parseDateText(txt)
    return parsed || undefined
  }

  mount(): void {
    const infos = this.collectItemInfos()
    void this.attachHandlersForInfos(infos).catch((err) => {
      console.error('exhentai mount archive check failed', err)
    })
  }

  private collectItemInfos(): ItemInfo[] {
    const $items = jquery(this.selector.container).find(this.selector.item)
    const infos: ItemInfo[] = []

    $items.each((index, elem) => {
      const $item = jquery(elem)
      const gid = this.extractGidFromGalleryLink($item)
      if (gid) $item.attr('id', `exhentai_gid_${gid}`)
      const $download = $item.find(this.selector.link).first()
      if ($download.length === 0) return
      const date = this.parseItemDate($item)
      infos.push({ index, $item, gid, $download, date })
    })

    return infos
  }

  private async attachHandlersForInfos(infos: ItemInfo[]): Promise<void> {
    const gids = Array.from(
      new Set(
        infos
          .map((i) => i.gid)
          .filter(Boolean)
          .map(Number)
      )
    )
    const archivesMap = gids.length > 0 ? await getHentaiArchivesMap(gids) : {}

    infos.forEach((info) => {
      const { index, $item, gid, $download, date } = info
      if (!$download) return

      // 将点击行为绑定到原始下载链接，移除克隆按钮的需要
      if (gid) $download.attr('data-gid', gid)

      // 保存原始 href 并移除默认跳转/弹窗行为
      const origHref = $download.attr('href')
      if (origHref) {
        $download.attr('data-orig-href', origHref)
        $download.removeAttr('href')
        $download.removeAttr('onclick')
        $download.css('cursor', 'pointer')
      }

      if (gid) {
        const gidNum = Number(gid)
        const archives = archivesMap[gidNum]
        // 取日期最新的存档记录
        const archive = archives && archives.length > 0
          ? archives.reduce((latest: HentaiArchiveDto, current: HentaiArchiveDto) =>
              dayjs(current.date).isAfter(dayjs(latest.date)) ? current : latest
            )
          : null
        if (archive) {
          const archiveDate = dayjs(archive.date)
          if (archiveDate.isValid() && date && archiveDate.isSame(date)) {
            // 日期相同：根据状态分别处理
            if (archive.status === HentaiArchiveStatus.DownloadSuccess) {
              $download.hide()
              return
            } else if (archive.status === HentaiArchiveStatus.NoNewerSeed) {
              this.applyArchiveStyle($download, archive.status)
              // 仍然绑定点击事件，允许用户点击下载过时种子
            } else {
              // 未知状态：不进行任何处理
            }
          } else {
            // 日期不同或缺失：不进行任何处理
          }
        }
      }

      $download.on('click', this.createDownloadHandler($download, index, gid, date))
    })
  }

  private createDownloadHandler($download: JQuery, index: number, gid?: string, date?: Dayjs) {
    return async (e: any) => {
      e.preventDefault()
      e.stopPropagation()
      console.log('exhentai download clicked', index, gid)

      const downloadHref = $download.attr('data-orig-href') || $download.data('orig-href')
      if (!downloadHref) {
        console.warn('exhentai: 没有找到原始下载链接 (data-orig-href)')
        ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
        return
      }

      try {
        const res = await fetchFirstTorrentFromDownloadPage(downloadHref)
        if (res.error) {
          console.warn('exhentai fetch error', res.error)
          ElNotification({ title: '提示', message: '请求下载页面失败', type: 'error' })
          return
        }

        // 有最新的种子，直接下载
        if (res.latest) {
          this.handleLatestTorrent(res.latest, $download, gid, date)
          return
        }

        // 处理过时种子
        await this.handleOutdatedTorrents(res.outdated, $download, gid, date)
      } catch (err) {
        console.error(err)
        ElNotification({ title: '提示', message: '请求下载页面失败', type: 'error' })
      }
    }
  }

  /**
   * 处理最新种子的下载
   */
  private async handleLatestTorrent(
    latest: TorrentEntry,
    $download: JQuery,
    gid?: string,
    date?: Dayjs
  ): Promise<void> {
    download(latest.href)
    if (gid) {
      try {
        await upsertHentaiArchive(Number(gid), date?.toDate(), HentaiArchiveStatus.DownloadSuccess)
        try {
          $download.hide()
        } catch (errHide) {
          // 忽略 DOM 操作错误
        }
      } catch (err) {
        console.warn('exhentai: upsertHentaiArchive failed', err)
      }
    }
  }

  /**
   * 处理过时种子的逻辑
   */
  private async handleOutdatedTorrents(
    outdated: TorrentEntry[],
    $download: JQuery,
    gid?: string,
    date?: Dayjs
  ): Promise<void> {
    if (outdated.length === 0) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 对 outdated 数组按日期从新到旧排序
    const sortedOutdated = this.sortOutdatedByDate(outdated)

    // 取最近的过时种子（数组第一个即最近）
    const mostRecentOutdated = sortedOutdated[0]

    if (!mostRecentOutdated) {
      ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
      return
    }

    // 查询 hentai-archive 是否有下载记录
    if (gid) {
      try {
        const archivesMap = await getDownloadedArchivesMap([Number(gid)])
        const archives = archivesMap[Number(gid)]
        const archive = archives && archives.length > 0 ? archives[0] : null

        if (archive) {
          // 比较日期：如果最近的过时种子比归档记录更新，则下载
          const archiveDate = dayjs(archive.date)
          const outdatedDate = this.parseDateText(mostRecentOutdated.dateText)

          if (outdatedDate && archiveDate.isValid() && outdatedDate.isAfter(archiveDate, 'day')) {
            // 过时种子比归档记录新，下载
            download(mostRecentOutdated.href)
            await upsertHentaiArchive(Number(gid), date?.toDate(), HentaiArchiveStatus.DownloadSuccess)
            try {
              $download.hide()
            } catch (errHide) {
              // 忽略 DOM 操作错误
            }
            return
          }
        } else {
          // 没有存档记录，直接下载最近的过时种子
          download(mostRecentOutdated.href)
          await upsertHentaiArchive(Number(gid), date?.toDate(), HentaiArchiveStatus.DownloadSuccess)
          try {
            $download.hide()
          } catch (errHide) {
            // 忽略 DOM 操作错误
          }
          return
        }
      } catch (err) {
        console.warn('exhentai: getDownloadedArchivesMap failed', err)
      }
    }

    // 过时种子不比归档新，标记为无新种子
    ElNotification({ title: '提示', message: '没有最新的种子', type: 'info' })
    if (gid) {
      try {
        // 使用最近过时种子的日期进行归档
        const outdatedDate = this.parseDateText(mostRecentOutdated.dateText)
        await upsertHentaiArchive(Number(gid), outdatedDate?.toDate(), HentaiArchiveStatus.NoNewerSeed)
        try {
          this.applyArchiveStyle($download, HentaiArchiveStatus.NoNewerSeed)
        } catch (errHide) {
          // 忽略 DOM 操作错误
        }
      } catch (err) {
        console.warn('exhentai: upsertHentaiArchive failed', err)
      }
    }
  }

  /**
   * 对过时种子数组按日期从新到旧排序
   */
  private sortOutdatedByDate(outdated: TorrentEntry[]): TorrentEntry[] {
    return [...outdated].sort((a, b) => {
      const dateA = this.parseDateText(a.dateText)
      const dateB = this.parseDateText(b.dateText)
      // 如果日期无效，放到数组末尾
      if (!dateA) return 1
      if (!dateB) return -1
      // 从新到旧排序（降序）
      return dateB.valueOf() - dateA.valueOf()
    })
  }

  /**
   * 解析日期文本为 Dayjs 对象，使用字典中定义的格式
   */
  private parseDateText(dateText: string): Dayjs | null {
    if (!dateText) return null

    // 尝试使用字典中定义的格式解析
    const formats = [FORMAT.DATE_TEXT, FORMAT.DATE_SIMPLE]

    for (const format of formats) {
      const d = dayjs(dateText, format)
      if (d.isValid()) return d
    }

    // 尝试直接解析（ISO 格式等）
    const d = dayjs(dateText)
    if (d.isValid()) return d

    return null
  }

  private applyArchiveStyle($download: JQuery, status: HentaiArchiveStatus) {
    // 更偏红的滤镜：增加饱和并稍微向红色偏移（使用负 hue-rotate），并将透明度设为 50%
    const filterCss = 'sepia(1) saturate(8) hue-rotate(-10deg) brightness(1.05) contrast(1)'
    const opacityVal = '0.5'
    try {
      const $img = $download.find('img').first()
      if ($img.length) {
        $img.css({ filter: filterCss, opacity: opacityVal })
      } else {
        $download.css({ filter: filterCss, opacity: opacityVal })
      }
      $download.addClass('archived-no-newer-seed')
    } catch (err) {
      // 忽略 DOM 操作错误
    }
  }
  resolveElements(elems: JQuery): Promise<JQuery[]> {
    throw new Error('Method not implemented.')
  }
  download(checkArchive: boolean): void {
    // throw new Error('Method not implemented.')
  }
  showControlPanel(): boolean {
    return false
  }

  allLoadCompleted(): void {
    // throw new Error('Method not implemented.')
  }
  checkSite(): boolean {
    return /(this.name)/i.test(document.URL)
  }
  updateInfo(item: JQuery, info: Info): void {
    throw new Error('Method not implemented.')
  }
}
