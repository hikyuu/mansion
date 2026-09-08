import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import type { Dayjs } from 'dayjs'
import {
  getHentaiArchivesMapByHash,
  upsertHentaiArchive,
  HentaiArchiveStatus,
  type HentaiArchiveDto
} from '@/dao/hentai-archive'
import { sha256Hex } from '@/common/hash'
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
  title: string
  titleHash?: string
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
    date: 'div.gl5t [id^="posted_"]',
    title: 'div.gl4t.glname.glink'
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

  /** 从画廊条目中提取标题文本（元素形如 <div class="gl4t glname glink">...</div>） */
  private extractTitle($item: JQuery): string {
    const $title = $item.find(this.selector.title!).first()
    if ($title.length > 0) {
      return ($title.text() || '').trim().slice(0, 255)
    }
    // 兜底：取标题链接（serialNumber）的整段文本
    const $link = $item.find(this.selector.serialNumber).first()
    return ($link.text() || '').trim().slice(0, 255)
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

  private insertCloseButton($item: JQuery, gid: string, date: Dayjs, title: string): void {
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
        await upsertHentaiArchive(Number(gid), date.toDate(), HentaiArchiveStatus.SkipDownload, title)
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
      const title = this.extractTitle($item)
      this.insertCloseButton($item, gid, date, title)
      const $download = $item.find(this.selector.link).first()
      infos.push({ index, $item, gid, gidNum: Number(gid), $download, date, title })
    })

    return infos
  }

  private async attachHandlersForInfos(infos: ItemInfo[]): Promise<void> {
    // 仅按标题 hash 匹配，不兼容 gid（gid 会随画廊更新/重传变动）
    const hashed = await Promise.all(
      infos.map(async (i) => (i.title ? await sha256Hex(i.title) : ''))
    )
    infos.forEach((info, idx) => {
      info.titleHash = hashed[idx]!
    })

    const hashes = Array.from(new Set(hashed.filter(Boolean)))
    const archivesByHash =
      hashes.length > 0
        ? await getHentaiArchivesMapByHash(hashes)
        : ({} as Record<string, HentaiArchiveDto[]>)
    const skipRead = useConfigStore().getSiteConfig.skipRead

    for (const info of infos) {
      const { index, gid, titleHash, $download, date, $item } = info

      // 命中归档：仅同一标题 hash 才视为同一画廊
      const archives = titleHash ? archivesByHash[titleHash] : undefined

      if (archives && archives.length > 0) {
        // 取最近操作（created_time 最大）的一条作为当前判定状态
        const archive = archives.reduce((latest, current) =>
          current.created_time.getTime() > latest.created_time.getTime() ? current : latest
        )
        // 命中条件：同一标题 hash 即视为同一画廊（gid 变动/重传也能命中）
        // 200/304 额外比较画廊日期：当前日期比存档更新 → 视为有新版本，允许重新下载
        const isNewer = !!date && date.valueOf() > archive.date.getTime()

        if (archive.status === HentaiArchiveStatus.DownloadSuccess) {
          if (!isNewer) {
            // 无更新版本：隐藏下载按钮
            $download.hide()
            continue
          }
          // 有更新版本：不隐藏，走下方绑定下载
        } else if (archive.status === HentaiArchiveStatus.NoNewerSeed) {
          if (!isNewer) {
            // 无更新：置灰，仍允许点击下载过时种子
            ExhentaiUtils.applyArchiveStyle($download)
          }
          // 有更新则不置灰，走下方绑定下载
        } else if (archive.status === HentaiArchiveStatus.SkipDownload) {
          // 用户标记跳过下载：不看日期，同标题 hash 即隐藏
          if (skipRead) $item.hide()
          // 无论 skipRead 是否开启，都不触发下载绑定
          continue
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

      const handler = new ExhentaiDownloadHandler($download, index, gid, date, info.title)
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
