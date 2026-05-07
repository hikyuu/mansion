import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import type { Info } from '@/store/sister-store'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import { fetchFirstTorrentFromDownloadPage } from './exhentai-api'
import { ElNotification } from 'element-plus'
import { download } from '@/download'
import { getHentaiArchivesByGids, upsertHentaiArchive } from '@/dao/hentai-archive'

type ItemInfo = {
  index: number
  $item: JQuery
  gid?: string
  $download?: JQuery
  date?: Date
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

  private parseItemDate($item: JQuery): Date | undefined {
    const $d = $item.find(this.selector.date).first()
    if ($d.length === 0) return undefined
    const txt = ($d.attr('title') || $d.text() || '').trim()
    if (!txt) return undefined
    const parsed = new Date(txt)
    if (!isNaN(parsed.getTime())) return parsed
    const m = txt.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/)
    if (m && m[1]) {
      const p = new Date(m[1])
      if (!isNaN(p.getTime())) return p
    }
    return undefined
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
    const archivesMap = gids.length > 0 ? await getHentaiArchivesByGids(gids) : {}

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

      // 如果已归档且日期一致，则隐藏下载按钮
      if (gid) {
        const gidNum = Number(gid)
        const archive = archivesMap[gidNum]
        if (
          archive &&
          archive.date &&
          date &&
          archive.date.getTime &&
          date.getTime &&
          archive.date.getTime() === date.getTime()
        ) {
          $download.hide()
          return
        }
      }

      $download.on('click', this.createDownloadHandler($download, index, gid, date))
    })
  }

  private createDownloadHandler($download: JQuery, index: number, gid?: string, date?: Date) {
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
        if (!res.href) {
          ElNotification({ title: '提示', message: '未找到下载链接', type: 'error' })
          return
        }
        if (res.isOutdated) {
          ElNotification({ title: '提示', message: '没有最新的种子', type: 'info' })
          return
        }

        // 使用统一下载入口处理跳转/下载
        download(res.href)
        // 上传日期信息（如果有）用于归档记录
        if (gid) {
          try {
            await upsertHentaiArchive(Number(gid), date)
          } catch (err) {
            console.warn('exhentai: upsertHentaiArchive failed', err)
          }
        }
      } catch (err) {
        console.error(err)
        ElNotification({ title: '提示', message: '请求下载页面失败', type: 'error' })
      }
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
