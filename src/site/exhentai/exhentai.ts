import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getHentaiArchivesMap,
  upsertHentaiArchive,
  HentaiArchiveStatus
} from '@/dao/hentai-archive'
import { useConfigStore } from '@/store/config-store'
import { ExhentaiDownloadHandler } from './exhentai-download-handler'
import { ExhentaiUtils } from './exhentai-utils'

type ItemInfo = {
  index: number
  $item: JQuery
  gid: string
  gidNum: number
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

  private insertCloseButton($item: JQuery, gid: string, date: Dayjs): void {
    const $titleLink = $item.find(this.selector.serialNumber).first()
    if ($titleLink.length === 0) return

    // 创建标题父容器，使标题与关闭按钮同行，关闭按钮始终右对齐
    const $titleContainer = jquery('<div>', {
      css: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%'
      }
    })

    const $closeBtn = jquery('<span>', {
      class: 'exhentai-close-btn',
      text: '×',
      css: {
        cursor: 'pointer',
        fontSize: '22px',
        fontWeight: 'bold',
        color: '#e74c3c',
        userSelect: 'none',
        lineHeight: '1',
        padding: '4px 8px'
      },
      title: '标记为跳过下载（不下载）'
    })

    $closeBtn.on('click', async (e: JQuery.Event) => {
      e.stopPropagation()
      e.preventDefault()
      try {
        await upsertHentaiArchive(Number(gid), date.toDate(), HentaiArchiveStatus.SkipDownload)
        $item.hide()
        console.log('exhentai: 标记跳过下载', gid, date.format())
      } catch (err) {
        console.error('exhentai: upsert SkipDownload failed', err)
        ExhentaiUtils.showNotification('标记跳过下载失败', 'error')
      }
    })

    // 将标题链接移入容器，追加关闭按钮
    $titleLink.before($titleContainer)
    $titleContainer.append($titleLink, $closeBtn)
    // 让标题链接占满剩余空间
    $titleLink.css({ flex: '1', minWidth: 0 })
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
      const date = this.parseItemDate($item)
      if (!date) return
      this.insertCloseButton($item, gid, date)
      const $download = $item.find(this.selector.link).first()
      infos.push({ index, $item, gid, gidNum: Number(gid), $download, date })
    })

    return infos
  }

  private async attachHandlersForInfos(infos: ItemInfo[]): Promise<void> {
    const gids = Array.from(new Set(infos.map((i) => i.gidNum).filter(Boolean)))
    const archivesMap = gids.length > 0 ? await getHentaiArchivesMap(gids) : {}
    const skipRead = useConfigStore().getSiteConfig.skipRead

    for (const info of infos) {
      const { index, gid, gidNum, $download, date, $item } = info

      if (gidNum) {
        const archives = archivesMap[gidNum]
        // 取日期最新的存档记录（Date.getTime 比较，避免 dayjs 对象创建开销）
        const archive =
          archives && archives.length > 0
            ? archives.reduce((latest, current) =>
                current.date.getTime() > latest.date.getTime() ? current : latest
              )
            : null
        if (archive) {
          if (date && dayjs(archive.date).isSame(date)) {
            // 日期相同：根据状态分别处理
            if (archive.status === HentaiArchiveStatus.DownloadSuccess) {
              
              $download.hide()
              continue
            } else if (archive.status === HentaiArchiveStatus.NoNewerSeed) {
              ExhentaiUtils.applyArchiveStyle($download)
              // 仍然绑定点击事件，允许用户点击下载过时种子
            } else if (archive.status === HentaiArchiveStatus.SkipDownload) {
              // 用户标记跳过下载
              if (skipRead) $item.hide()
              // 无论 skipRead 是否开启，都不触发下载绑定
              continue
            } else {
              // 未知状态：不进行任何处理
            }
          } else {
            // 日期不同或缺失：不进行任何处理
          }
        }
      }
      if (!$download) continue

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

      const handler = new ExhentaiDownloadHandler($download, index, gid, date)
      $download.on('click', handler.createHandler())
    }
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
