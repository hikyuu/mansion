import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import { parseSerialNumber } from '@/common/serial-number'
import { SiteAbstract } from '../site-abstract'
import jquery from 'jquery'
import { WaterfallStatus } from '@/dictionary'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { ElNotification } from 'element-plus'
import { pickJavdbMagnet } from '@/site/javdb/javdb-api'
import { uploadDaily } from '@/dao/onejav-daily-dao'
import { fetchHistoriesSince, loadDailyHistory, uploadHistory } from '@/dao/browse-history'
import { useDailyHistoryStore } from '@/store/daily-history-store'
import { resolveOnejavTorrent } from '@/site/onejav/onejav-api.ts'
import { submitDownload, type ResolvedDownloadSource } from '@/download/intent'
import { CloudflareBlockedError } from '@/common/cloudflare'
import { SiteId } from '@/site/site-id'

/**
 * javdb 侧解析结果：一次请求同时给出「高分磁力」与「退而求其次的那条磁力」。
 *
 * 之所以两条一起返回：onejav 的种子被 Cloudflare 拦下时要退回 javdb 磁力，
 * 而此时 javdb 已经解析过一次，再发一次搜索 + 详情请求既慢（可能触发 FlareSolverr）
 * 又没有新信息 —— 直接复用同一张详情页里挑出的那条即可。
 */
export interface JavdbMagnetResult {
  /** 高分磁力（名字带 -c / -uc）：命中即首选交付 */
  magnet: string | null
  /** 同一张详情页里挑出的最好一条（可能不是高分），仅供 Cloudflare 拦截后兜底 */
  fallbackMagnet: string | null
  /** 未命中高分时的原因，进通知正文 */
  reason?: string
}

/**
 * javdb 侧的磁链解析：只解析不提交，一次请求拿全。
 * FC2 不受 javdb 支持；任何解析异常都折算成「未命中原因」，交给下一级兜底，
 * 原因最终会出现在下载通知里（如「onejav 种子（javdb 未命中：没有找到高分磁力链接）」）。
 */
export async function resolveJavdbMagnet(serialNumber: string): Promise<JavdbMagnetResult> {
  if (parseSerialNumber(serialNumber).isFc2) {
    return { magnet: null, fallbackMagnet: null, reason: 'FC2 不受 javdb 支持' }
  }
  try {
    const best = await pickJavdbMagnet(serialNumber)
    const href = best.magnet.attr('href')
    if (!href) return { magnet: null, fallbackMagnet: null, reason: 'javdb 没有返回磁力链接' }
    return best.score > 0
      ? { magnet: href, fallbackMagnet: href }
      : { magnet: null, fallbackMagnet: href, reason: '没有找到高分磁力链接' }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    console.warn('[onejav] javdb 磁链解析失败，回退下一级', { serialNumber, reason })
    return { magnet: null, fallbackMagnet: null, reason: message || 'javdb 解析失败' }
  }
}

export const ONEJAV_DOWNLOAD = "a[title='Download .torrent']"

/**
 * onejav 的「番号 → 下载地址」链条，三级依次降级：
 * 1. javdb 高分磁力；
 * 2. onejav 详情页里的种子（`downloadHref` 由调用方从 DOM 取）；
 * 3. 种子链接被 Cloudflare 拦下时，退回第 1 步那次 javdb 解析里挑出的磁力（不设高分门槛、不重试）；
 *    onejav 的 Turnstile 只认顶层导航，脚本侧拿不到种子字节，再请求也是 403。
 *
 * 前两级都没命中时，未命中原因写进 note，最终出现在下载通知的备注里。
 */
export async function resolveOnejavSource(
  serialNumber: string,
  downloadHref?: string
): Promise<ResolvedDownloadSource> {
  const javdb = await resolveJavdbMagnet(serialNumber)
  if (javdb.magnet) {
    return { url: javdb.magnet, source: { label: 'javdb 高分磁力', origin: 'javdb' } }
  }

  const missNote = javdb.reason ? `javdb 未命中：${javdb.reason}` : 'javdb 未命中'
  if (!downloadHref) throw new Error(`onejav 详情页没有下载按钮（${missNote}）`)

  let seed: string | null
  try {
    seed = await resolveOnejavTorrent(downloadHref)
  } catch (error) {
    if (!(error instanceof CloudflareBlockedError)) throw error
    return fallbackToJavdb(serialNumber, javdb, error)
  }
  if (!seed) throw new Error(`onejav 下载页解析不到种子地址（${missNote}）`)
  return {
    url: seed,
    source: { label: 'onejav 种子', note: missNote, origin: 'onejav' },
    // 详情页能解析、种子字节却可能被拦（交付阶段才知道）：备用地址提前挂上，拦截时改投它
    ...(javdb.fallbackMagnet ? { fallback: javdbFallback(javdb.fallbackMagnet) } : {})
  }
}

/** javdb 兜底的来源与备注：一眼看出「这次为什么不是高分版本」 */
function javdbFallback(magnet: string): ResolvedDownloadSource {
  return {
    url: magnet,
    source: { label: 'javdb 磁力', note: 'onejav 种子被 Cloudflare 拦截', origin: 'javdb' }
  }
}

/**
 * 解析阶段就被拦：直接改投 javdb 已解析到的磁力。
 * 不重试 onejav（挑战只认顶层导航，脚本侧再请求也是 403），也不重新请求 javdb。
 */
function fallbackToJavdb(
  serialNumber: string,
  javdb: JavdbMagnetResult,
  blocked: CloudflareBlockedError
): ResolvedDownloadSource {
  console.warn('[onejav] 种子链接被 Cloudflare 拦截，改用 javdb 已解析到的磁力（不重试）', {
    serialNumber,
    block: blocked.message,
    reused: javdb.fallbackMagnet !== null
  })
  if (javdb.fallbackMagnet) return javdbFallback(javdb.fallbackMagnet)
  throw new Error(`onejav 种子被 Cloudflare 拦截，javdb 回退未命中：${javdb.reason ?? '原因未知'}`)
}

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
        const href = jquery('#' + serialNumber)
          .find(ONEJAV_DOWNLOAD)
          .first()
          .attr('href')
        return resolveOnejavSource(serialNumber, href)
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
