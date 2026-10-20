import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { SiteAbstract } from '../site-abstract'
import waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import dayjs, { type Dayjs } from 'dayjs'
import {
  getHentaiArchivesMapByHash,
  upsertHentaiArchive,
  resolveArchiveWaterline,
  pickLatestOperatedArchive,
  HentaiArchiveStatus,
  type HentaiArchiveDto
} from '@/dao/hentai-archive'
import { sha256Hex } from '@/common/hash'
import { useConfigStore } from '@/store/config-store'
import { WaterfallStatus } from '@/dictionary'
import {
  useDownloadQueueStore,
  setDownloadQueueExecutor,
  type DownloadQueueItem,
  type EnqueueDownloadItem
} from '@/store/download-queue-store'
import { ExhentaiDownloadHandler, type DownloadOutcome } from './exhentai-download-handler'
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
    // 页尾的 Next：exhentai 头尾各有一个（#unext / #dnext），瀑布流取最后一个
    next: 'a#dnext, a#unext',
    item: 'div.gl1t',
    container: 'div.itg.gld',
    // 分页锚点：落地时用它整条替换成 The End
    pagination: '#dnext',
    serialNumber: 'a:has(.gl4t.glname.glink)',
    link: 'div.gl5t .gldown a',
    date: 'div.gl5t [id^="posted_"]',
    title: 'div.gl4t.glname.glink',
    // 列表自带缩略图，追加时直接把原 DOM 交给瀑布流
    nativeThumbnail: true
  } as Selector
  theme = {
    PRIMARY_COLOR: '#00d1b2',
    SECONDARY_COLOR: '#e3f5f3',
    WARNING_COLOR: '#fadd65'
  }
  /**
   * 列表页批量查到的归档记录（含 200/304/400），供下载判重复用，避免逐条查库。
   * null = 尚未查询；查过但没有记录的 hash 不出现在 key 中（由注入方转成 []）
   */
  private archiveCache: Record<string, HentaiArchiveDto[]> | null = null

  /** 已处理过的 gid：翻页重叠或重复触发时避免同一条目被二次绑定 */
  private processedGids = new Set<string>()

  /** 瀑布流触底哨兵 */
  private sentinel: HTMLElement | null = null
  private sentinelObserver: IntersectionObserver | null = null

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
    setDownloadQueueExecutor((item) => this.executeQueuedDownload(item))
    const $items = jquery(this.selector.container).find(this.selector.item)
    const infos = this.collectItemInfos($items)
    void this.attachHandlersForInfos(infos).catch((err) => {
      console.error('exhentai mount archive check failed', err)
    })
    this.enableWaterfall($items)
  }

  /** 只在列表页启用瀑布流：画廊详情页没有 gl1t 条目 */
  private enableWaterfall($items: JQuery): void {
    if ($items.length === 0) return
    this.waterfall
      .flow()
      .then(() => this.observeSentinel())
      .catch((err) => console.error('exhentai waterfall flow failed', err))
  }

  /**
   * 触底自动追加下一页。
   * flow() 的懒加载会在 lazyLimit 处停下，之后靠滚动继续追加，否则页面到 100 条就再也长不出来了。
   */
  private observeSentinel(): void {
    // 配置里关掉瀑布流时，flow() 只会提示，不应再由滚动追加
    if (useConfigStore().getSiteConfig.scrollStatus === WaterfallStatus.close.code) return
    if (this.sentinelObserver !== null || this.waterfall.page.isEnd) return
    const sentinel = document.createElement('div')
    sentinel.id = 'mansion-exhentai-sentinel'
    sentinel.style.height = '1px'
    jquery(this.selector.container).after(sentinel)
    this.sentinel = sentinel

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (this.waterfall.page.isEnd || this.waterfall.page.nextUrl === null) return
        // 并发由 Waterfall 内部的锁兜底，这里不额外加状态
        void this.loadNext()
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    this.sentinelObserver = observer
  }

  private stopSentinel(): void {
    this.sentinelObserver?.disconnect()
    this.sentinelObserver = null
    this.sentinel?.remove()
    this.sentinel = null
  }

  /**
   * 瀑布流追加完成后的回调：只处理新增条目，复用首屏的归档链路
   * （判重、隐藏已下载/已跳过、304 自动入队、绑定下载与关闭按钮）
   */
  async onItemsAppended(items: JQuery[]): Promise<void> {
    const nodes = items.map(($item) => $item[0]).filter((elem): elem is HTMLElement => elem !== undefined)
    const infos = this.collectItemInfos(jquery(nodes))
    if (infos.length === 0) return
    try {
      await this.attachHandlersForInfos(infos)
    } catch (err) {
      console.error('exhentai waterfall archive check failed', err)
    }
  }

  /**
   * 队列执行器：按 gid 重新定位 DOM 并构造 handler，避免在队列里持有闭包。
   * handler 以 silent 模式运行，通知统一由面板呈现。
   */
  private async executeQueuedDownload(item: DownloadQueueItem): Promise<DownloadOutcome> {
    const $item = jquery(`#exhentai_gid_${item.gid}`)
    if ($item.length === 0) {
      return { ok: false, downloaded: false, kind: 'dom-missing', message: '条目已不在页面中' }
    }

    const $download = $item.find(this.selector.link).first()
    if ($download.length === 0) {
      return { ok: false, downloaded: false, kind: 'no-download-button', message: '该条目没有下载按钮' }
    }

    const handler = new ExhentaiDownloadHandler(
      $download,
      item.index,
      item.gid,
      dayjs(item.dateMs),
      item.title,
      item.titleHash,
      // 注入列表页缓存（未命中 = 查过但没有记录，同样是有效值，避免 handler 再查库）
      item.titleHash ? (this.archiveCache?.[item.titleHash] ?? []) : undefined,
      true
    )
    const outcome = await handler.execute()
    try {
      $download.attr('data-mansion-queue', outcome.ok ? 'success' : 'failed')
    } catch {
      // 忽略 DOM 操作错误
    }
    return outcome
  }

  private collectItemInfos($scope?: JQuery): ItemInfo[] {
    // $scope 传入的集合既可能是容器，也可能是条目本身（瀑布流追加回调），两种都要覆盖
    const $items = $scope
      ? $scope.filter(this.selector.item).add($scope.find(this.selector.item))
      : jquery(this.selector.container).find(this.selector.item)
    const infos: ItemInfo[] = []

    $items.each((index, elem) => {
      const $item = jquery(elem)
      const gid = this.extractGidFromGalleryLink($item)
      // 游标翻页仍可能与上一页尾部重叠，同一条目只处理一次
      if (!gid || this.processedGids.has(gid)) return
      this.processedGids.add(gid)
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
    const hashed = await Promise.all(infos.map(async (i) => (i.title ? await sha256Hex(i.title) : '')))
    infos.forEach((info, idx) => {
      info.titleHash = hashed[idx]!
    })

    const hashes = Array.from(new Set(hashed.filter(Boolean)))
    const archivesByHash =
      hashes.length > 0 ? await getHentaiArchivesMapByHash(hashes) : ({} as Record<string, HentaiArchiveDto[]>)
    // 本次批量结果同时作为下载判重的数据源（该查询不带 status，天然含 200/304/400）
    // 注意是"合并"而不是覆盖：追加页若覆盖首屏结果，前面页的 hash 会被误判成"无归档"
    this.archiveCache = { ...this.archiveCache, ...archivesByHash }
    const siteConfig = useConfigStore().getSiteConfig
    const skipRead = siteConfig.skipRead
    // 开启后只保留可直接下载的条目（已下载无新版本 / 过时种子 / 用户跳过 / 无种子 全部整条隐藏）
    const onlyShowDownloadable = siteConfig.onlyShowDownloadable
    const hideUnavailable = ($target: JQuery, gid: string, title: string, reason: string) => {
      $target.hide()
      console.log('exhentai: 隐藏不可下载条目', gid, reason, title)
    }
    // 304 且无更新的条目：绑定完成后统一入队（此时 data-orig-href 已就绪）
    const queueItems: EnqueueDownloadItem[] = []

    for (const info of infos) {
      const { index, gid, titleHash, $download, date, $item } = info
      let queueDownload = false

      // 命中归档：仅同一标题 hash 才视为同一画廊
      // 查过但没有记录时给 []（有效值），便于下载判重区分"数据未知"与"确实没有归档"
      const archives = titleHash ? (archivesByHash[titleHash] ?? []) : undefined

      if (archives && archives.length > 0) {
        // 当前状态由"最后一次写入的记录"决定：created_time 在 upsert 时已刷新为写入时刻，
        // 因此哪条记录最后写下，就代表该条目最近一次处理的真实结果（200 已下载 / 304 只有过时种子 / 400 用户跳过）
        const latestOperated = pickLatestOperatedArchive(archives)

        if (latestOperated?.status === HentaiArchiveStatus.SkipDownload) {
          // 用户标记跳过下载：不看日期，同标题 hash 即隐藏
          if (onlyShowDownloadable) {
            hideUnavailable($item, gid, info.title, '用户标记跳过下载')
          } else if (skipRead) {
            $item.hide()
          }
          // 无论 skipRead 是否开启，都不触发下载绑定
          continue
        }

        if (latestOperated?.status === HentaiArchiveStatus.NoNewerSeed) {
          // 只拿到过时种子：置灰并加入下载队列，每次进页面自动复查下载页（等最新种子出现）
          // 注意：这里不能用"是否曾下载过 200"当门槛——200 行不会因最新种子下架而消失，
          // 一旦用它拦住，这些画廊的过时种子重载自动检测会永久失效
          if ($download.length > 0) {
            ExhentaiUtils.applyArchiveStyle($download)
            queueDownload = true
          }
          // 仅显示可下载时整条隐藏，但不 continue：仍要绑定并入队，保证后台自动复查最新种子
          if (onlyShowDownloadable) {
            hideUnavailable($item, gid, info.title, '只拿到过时种子')
          }
        } else if (latestOperated?.status === HentaiArchiveStatus.DownloadSuccess) {
          // 已提交过最新种子：只有画廊日期比判重水位线更新（与 handler 同一口径）才算有新版本
          const waterline = resolveArchiveWaterline(archives)
          const isNewer = !!date && !!waterline && date.valueOf() > waterline.date.getTime()
          if (!isNewer) {
            // 无更新版本：按开关隐藏整条画廊或仅隐藏下载按钮，不入队
            if (onlyShowDownloadable) {
              hideUnavailable($item, gid, info.title, '已下载且无新版本')
            } else {
              $download.hide()
            }
            continue
          }
          // 有更新版本：不隐藏，走下方绑定下载（不自动入队）
        }
      }
      // 注意：空 jQuery 也是真值，必须用 length 判断
      // 没有种子时 div.gldown 里只有置灰图标（img[title="No torrents available"]），没有 a[href]，即不可下载
      if (!$download || $download.length === 0 || !$download.attr('href')) {
        if (onlyShowDownloadable) {
          hideUnavailable($item, gid, info.title, '没有种子')
        }
        continue
      }

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

      // 复用上面的列表页批量结果作为下载判重数据，避免 handler 二次查库
      const handler = new ExhentaiDownloadHandler($download, index, gid, date, info.title, titleHash, archives)
      $download.on('click', handler.createHandler())

      // 手动点击路径已就绪，此时把 304 无更新的条目交给队列自动执行
      if (queueDownload && titleHash) {
        $download.attr('data-mansion-queue', 'pending')
        queueItems.push({ gid, title: info.title, titleHash, index, dateMs: date.valueOf() })
      }
    }

    if (queueItems.length > 0) {
      useDownloadQueueStore().enqueue(queueItems)
    }
  }

  async resolveElements(elems: JQuery): Promise<JQuery[]> {
    // exhentai 列表自带缩略图，这里只需把条目原样交回瀑布流
    if (!elems || elems.length === 0) return []
    return elems.toArray().map((elem) => jquery(elem))
  }
  download(): void {
    // throw new Error('Method not implemented.')
  }
  showControlPanel(): boolean {
    return false
  }

  allLoadCompleted(): void {
    this.hasLoadCompleted = true
    this.stopSentinel()
  }
  checkSite(): boolean {
    return /(^|\.)exhentai\.org$/i.test(location.hostname)
  }
  updateInfo(): void {
    throw new Error('Method not implemented.')
  }
}
