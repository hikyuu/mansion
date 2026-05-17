import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import dayjs, { type Dayjs } from 'dayjs'
import { getHentaiArchivesMap, HentaiArchiveStatus, type HentaiArchiveDto } from '@/dao/hentai-archive'
import { ExhentaiDownloadHandler } from './exhentai-download-handler'
import { ExhentaiUtils } from './exhentai-utils'

type ItemInfo = {
  index: number
  $item: JQuery
  gid: string
  $download: JQuery
  date: Dayjs
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
    } catch {
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
    const parsed = ExhentaiUtils.parseDateText(txt)
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
      if (!gid) return
      $item.attr('id', `exhentai_gid_${gid}`)
      const $download = $item.find(this.selector.link).first()
      if ($download.length === 0) return
      const date = this.parseItemDate($item)
      if (!date) return
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
      const { index, gid, $download, date } = info
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
        const archive =
          archives && archives.length > 0
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
              ExhentaiUtils.applyArchiveStyle($download)
              // 仍然绑定点击事件，允许用户点击下载过时种子
            } else {
              // 未知状态：不进行任何处理
            }
          } else {
            // 日期不同或缺失：不进行任何处理
          }
        }
      }

      const handler = new ExhentaiDownloadHandler($download, index, gid, date)
      $download.on('click', handler.createHandler())
    })
  }

  resolveElements(): Promise<JQuery[]> {
    throw new Error('Method not implemented.')
  }
  download(): void {
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
  updateInfo(): void {
    throw new Error('Method not implemented.')
  }
}
