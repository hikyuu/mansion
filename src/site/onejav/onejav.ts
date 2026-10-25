import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import { parseSerialNumber } from '@/common/serial-number'
import { SiteAbstract } from '../site-abstract'
import jquery from 'jquery'
import { WaterfallStatus } from '@/dictionary'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { ElNotification } from 'element-plus'
import { highScoreMagnet } from '@/site/javdb/javdb-api'
import { uploadDaily } from '@/dao/onejav-daily-dao'
import { fetchHistoriesSince, loadDailyHistory, uploadHistory } from '@/dao/browse-history'
import { useDailyHistoryStore } from '@/store/daily-history-store'
import { resolveOnejavSeed } from '@/site/onejav/onejav-api.ts'
import { submitDownload } from '@/download/intent'
import { SiteId } from '@/site/site-id'

/** javdb 侧解析结果：命中返回磁链，未命中带上原因（进通知正文） */
export interface JavdbMagnetResult {
  magnet: string | null
  reason?: string
}

/**
 * javdb 侧的磁链解析：只解析不提交。
 * FC2 不受 javdb 支持；任何解析异常都折算成「未命中原因」，交给 onejav 自身种子兜底，
 * 原因最终会出现在下载通知里（如「onejav 种子（javdb 未命中：没有找到高分磁力链接）」）。
 */
export async function resolveJavdbMagnet(serialNumber: string): Promise<JavdbMagnetResult> {
  if (parseSerialNumber(serialNumber).isFc2) return { magnet: null, reason: 'FC2 不受 javdb 支持' }
  try {
    const magnet = await highScoreMagnet(serialNumber)
    const href = magnet?.attr('href')
    return href ? { magnet: href } : { magnet: null, reason: 'javdb 没有返回磁力链接' }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    console.warn('[onejav] javdb 磁链解析失败，回退 onejav 种子', { serialNumber, reason })
    return { magnet: null, reason: message || 'javdb 解析失败' }
  }
}

export const ONEJAV_DOWNLOAD = "a[title='Download .torrent']"

export const onejav_selector: Selector = {
  next: 'a.pagination-next.button.is-primary',
  item: 'div.card.mb-3',
  container: 'body>.container',
  pagination: '.pagination.is-centered',
  serialNumber: 'h5.title.is-4.is-spaced a',
  link: 'h5.title.is-4.is-spaced',
  date: 'p.subtitle a',
  // onejav 的日期就是这个链接的 href（形如 /2026/10/01）
  pathDateFrom: 'href'
}

export class Onejav extends SiteAbstract {
  public name = 'onejav'
  public siteId = SiteId.ONEJAV
  public waterfall: Waterfall
  selector: Selector = onejav_selector
  theme = {
    PRIMARY_COLOR: '#00d1b2',
    SECONDARY_COLOR: '#e3f5f3',
    WARNING_COLOR: '#fadd65'
  }
  /** 增量拉取浏览历史的游标：上次成功拉到哪个时刻为止 */
  private historyCursor = new Date()

  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }
  mount(): void {
    this.addStyle()
    this.homeVisible()
    this.enableWaterfall()
  }

  /** 归档日期页（路径能解析出日期）条目少，用配置的模式；其余页面页数多，强制懒加载 */
  protected waterfallStatus(): number | null {
    if (isNaN(Date.parse(location.pathname))) {
      ElNotification({ title: '瀑布流', message: `页数可能较多强制启用懒加载模式`, type: 'info' })
      return WaterfallStatus.lazy.code
    }
    return null
  }


  // save(serialNumber: string): void {
  //   const info = this.sister.getInfo(serialNumber)
  //   if (!info) {
  //     return
  //   }
  //   const pathDate = info.pathDate
  //   if (pathDate === undefined || pathDate === '') {
  //     ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
  //     return
  //   }
  //   if (info.haveRead) {
  //     console.log('已经记录', serialNumber)
  //     return
  //   }
  //   uploadHistory(serialNumber, info).then(() => {
  //     this.sister.updateInfo({ serialNumber, haveRead: true, status: 200 })
  //   })
  // }

  async download(checkArchive: boolean): Promise<void> {
    const serialNumber = this.sister.currentSister?.serialNumber ?? this.sister.current_key
    await submitDownload({
      serialNumber,
      checkArchive,
      resolveSource: async () => {
        if (!serialNumber) return null
        console.log('下载', serialNumber)
        const javdb = await resolveJavdbMagnet(serialNumber)
        if (javdb.magnet) {
          return { url: javdb.magnet, source: { label: 'javdb 高分磁力', origin: 'javdb' } }
        }
        const missNote = javdb.reason ? `javdb 未命中：${javdb.reason}` : 'javdb 未命中'
        const href = jquery('#' + serialNumber)
          .find(ONEJAV_DOWNLOAD)
          .first()
          .attr('href')
        if (!href) throw new Error(`onejav 详情页没有下载按钮（${missNote}）`)
        const seed = await resolveOnejavSeed(href)
        if (!seed) throw new Error(`onejav 下载页解析不到种子地址（${missNote}）`)
        return {
          url: seed.url,
          source: { label: 'onejav 种子', note: missNote, origin: 'onejav' },
          ...(seed.handoff ? { handoff: seed.handoff } : {})
        }
      }
    })
  }

  closeDetailPage() {
    if (location.pathname.includes('torrent')) {
      window.close()
    }
  }

  showControlPanel(): boolean {
    return !!jquery('body').has(this.selector.item).length
  }

  allLoadCompleted(): void {
    super.allLoadCompleted()
    uploadDaily(location.pathname, this.sister.sisterNumber, true)
      .then()
      .catch((error) => console.error('上传每日统计失败', error))
  }

  protected addStyle() {
    GM_addStyle(`.max{width:100%} .min{width:100%} `)
  }

  /**
   * 回到页面时把「上次拉取之后」新增的浏览历史合并进来。
   * 游标归这里所有：拉成功才前移，失败下次重拉同一段，不会丢行。
   */
  private homeVisible() {
    console.log(`监听页面切换状态`, document.visibilityState)
    jquery(document).on('visibilitychange', () => {
      if (document.visibilityState != 'visible') return
      const since = this.historyCursor
      fetchHistoriesSince(since)
        .then((histories) => {
          this.historyCursor = new Date()
          const pathDateSet = new Set<string>()
          histories.forEach((history) => {
            pathDateSet.add(history.path_date)
            const info = this.sister.getInfo(history.serial_number)
            if (info === undefined) return
            if (info.haveRead) return
            this.sister.updateInfo({ serialNumber: history.serial_number, haveRead: true })
            if (info.pathDate !== history.path_date || info.site !== history.site) {
              this.sister.updateInfo({ serialNumber: history.serial_number, repeatSite: history.site })
              uploadHistory(info.serialNumber, info)
                .then()
                .catch((error) => console.error('补传浏览历史失败', info.serialNumber, error))
            }
          })
          return loadDailyHistory(pathDateSet, this.siteId)
        })
        .then((rows) => {
          if (rows) useDailyHistoryStore().fill(rows)
        })
        .catch((error) => console.error('加载最新浏览历史失败', error))
    })
  }
}
