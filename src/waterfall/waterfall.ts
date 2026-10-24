import jquery from 'jquery'
import { extractItems, Pagination, resolveNextUrl } from './pagination'
import { ElNotification } from 'element-plus'
import { WaterfallStatus } from '@/dictionary'
import { reactive } from 'vue'
import { useSisterStore } from '@/store/sister-store'
import { useConfigStore } from '@/store/config-store.ts'

const allReadPageLimit = 5

/**
 * Waterfall 对站点的要求。
 * 窄接口而非 SiteAbstract：避免 waterfall ↔ site-abstract 的循环依赖。
 */
export interface WaterfallHost {
  resolveElements(elems: JQuery): Promise<JQuery[]>
  onItemsAppended?(items: JQuery[]): void | Promise<void>
  allLoadCompleted(): void
  onScrollEvent(windowHeight: number, scrollTop: number): void
}

export default class {
  /** 分页源。只在本模块内推进；外部要看「还有没有下一页」请用 hasMore */
  private page: Pagination
  private lock: Lock = new Lock()
  private selector: Selector
  private readonly anchor: HTMLElement | undefined = undefined
  private host: WaterfallHost
  private allReadedPage = 0

  constructor(host: WaterfallHost, selector: Selector) {
    this.host = host
    this.selector = selector
    // 需要响应式：组件 watch hasMore 时要追到 isEnd 的变化；
    // reactive 的类型还原会丢掉 private 字段，故断言回类类型
    this.page = reactive(new Pagination(selector, extractItems(document, selector), this.getBaseURI())) as Pagination
    const $pageNation = jquery(this.selector.pagination)
    if ($pageNation.length > 0) {
      this.anchor = $pageNation[0]
    }
  }

  /** 还有下一页吗。组件与站点都看这个，不要读分页源内部字段 */
  get hasMore(): boolean {
    return !this.page.isEnd
  }

  /**
   * 未读条目还够多吗 —— 懒加载的水位判据。
   * 面板的「翻到快没读了就补一页」与内部批量的「读够了就停」共用这一处，避免两处不等式漂移。
   */
  shouldLoadMore(): boolean {
    const unread = useSisterStore().sisterNumber - useSisterStore().haveReadNumber
    return unread <= useConfigStore().getSiteConfig.lazyLimit
  }

  async flow(waterfallScrollStatus: number | null = null) {
    if (jquery(this.selector.item).length <= 0) {
      console.info(`没有妹妹`)
      return
    }
    await this.loadThumbnail(this.page.detail)
    this.setSisterNumber()

    if (waterfallScrollStatus == null) {
      waterfallScrollStatus = useConfigStore().getSiteConfig.scrollStatus
    }

    switch (waterfallScrollStatus) {
      case WaterfallStatus.close.code:
        ElNotification({ title: '瀑布流', message: `瀑布流已关闭`, type: 'info' })
        break
      case WaterfallStatus.lazy.code:
        this.flowLazy()
        break
      case WaterfallStatus.oneStep.code:
        this.flowOneStep()
        break
    }
  }

  private flowLazy() {
    ElNotification({ title: '瀑布流', message: `启动懒加载`, type: 'info' })
    this.loadNext(false).then()
  }

  private flowOneStep() {
    ElNotification({ title: '瀑布流', message: `启动一步到位模式`, type: 'info' })
    this.loadNext(true).then()
  }

  private async loadNext(oneStep = false) {
    if (this.page.isEnd) return
    console.log(`===加载下一页===`)
    const nextUrl = resolveNextUrl(document, this.selector, this.getBaseURI())
    if (nextUrl === null) {
      this.isEnd()
      console.log('===当前已经是最后一页===')
      return
    }
    this.page.nextUrl = nextUrl
    await this.fetchNextSync(oneStep)
  }

  async onScrollEvent() {
    //窗口高度
    const windowHeight = jquery(window).height()
    if (windowHeight === undefined) {
      console.log('获取不到窗口高度')
      return false
    }
    //滚动高度
    const scrollTop = jquery(window).scrollTop()
    if (scrollTop === undefined) {
      console.log('获取不到滚动高度')
      return false
    }
    this.host.onScrollEvent(windowHeight, scrollTop)
    return true
  }

  /**
   * 从当前位置继续追加。第一次调用时还没有下一页地址，先解析出来再取；
   * 解析不到就落地 —— 否则首个 appendNext 会把瀑布流直接判死。
   */
  async appendNext(oneStep: boolean = false) {
    if (this.lock.locked) {
      console.log(`下一页正在加载中`)
      return
    }
    if (this.page.nextUrl === null) {
      await this.loadNext(oneStep)
      return
    }
    await this.fetchNextSync(oneStep)
  }

  private async appendNextLocal() {
    if (this.page.isEnd) {
      console.log(`没有下一页`)
      return this.end()
    }
    if (this.page.nextDetail === null) {
      console.log(`没有获取到下一页内容`)
      return this.isEnd()
    }
    console.log(`加载下一页缩略图`)
    const items = await this.loadThumbnail(this.page.nextDetail)
    if (items.length === 0) {
      this.allReadedPage++
    } else {
      this.allReadedPage = 0
      jquery(this.selector.container).append(items)
      this.setSisterNumber()
      // 追加条目交给站点复用首屏的条目处理逻辑（判重、隐藏、绑定、入队等）
      try {
        await this.host.onItemsAppended?.(items)
      } catch (err) {
        console.error('瀑布流: 追加条目回调失败', err)
      }
    }
    if (this.allReadedPage >= allReadPageLimit) {
      console.log('连续5页没有缩略图，停止加载')
      this.isEnd()
      return
    }
    this.page.nextDetail = null
  }

  isEnd() {
    this.page.isEnd = true
    this.host.allLoadCompleted()
    ElNotification({ title: '提示', message: `瀑布流落地了`, type: 'success' })
  }

  getBaseURI() {
    const _ = location
    return `${_.protocol}//${_.hostname}${_.port && `:${_.port}`}`
  }

  async fetchNextSync(oneStep: boolean = false) {
    if (this.lock.locked) {
      return
    }
    this.lock.lock()
    try {
      // 用循环代替递归：锁只在整段流程外层持有，递归版本需要在中途 unlock 才能继续
      for (;;) {
        const outcome = await this.page.fetchNext()
        if (outcome === 'end') {
          this.isEnd()
          return
        }
        if (outcome === 'blocked') {
          ElNotification({ title: '瀑布流', message: '下一页没有内容，已停止加载', type: 'warning' })
          this.isEnd()
          return
        }
        if (outcome === 'failed') return

        await this.appendNextLocal()
        if (this.page.isEnd) return
        if (!oneStep && !this.shouldLoadMore()) {
          // 未读还够多，剩下的留给滚动触发
          return
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      this.lock.unlock()
    }
  }

  end() {
    // $(window).off('scroll');
    if (this.anchor === undefined) return
    const $end = jquery(`<h1>The End</h1>`)
    const $anchor = jquery(this.anchor)
    // 分页条整体替换，避免只换掉"下一页"链接后留下残缺的页码
    const $bar = $anchor.closest('table, .gtb')
    const $target = $bar.length > 0 ? $bar : $anchor
    $target.replaceWith($end)
  }

  setSisterNumber() {
    const sisterNumber = jquery(this.selector.item).length
    if (sisterNumber === 0) {
      console.error('没有找到妹妹！')
    }
    useSisterStore().sisterNumber = sisterNumber
    return sisterNumber
  }

  private async loadThumbnail(detail: JQuery) {
    // 列表自带缩略图：无需站点二次解析，也不受"加载缩略图"开关影响
    // （若受开关影响会返回空数组，被 appendNextLocal 误判为"整页没有条目"而提前落地）
    if (this.selector.nativeThumbnail) {
      return detail.toArray().map((elem) => jquery(elem))
    }
    if (useConfigStore().getSiteConfig.loadThumbnailSwitch) {
      return await this.host.resolveElements(detail)
    }
    return []
  }
}

export declare interface Selector {
  /**
   * 下一页链接选择器
   */
  next: string
  /**
   * 妹妹元素选择器
   */
  item: string
  /**
   * 妹妹上层元素选择器
   */
  container: string
  /**
   * 分页元素选择器
   */
  pagination: string
  /**
   * 番号选择器
   */
  serialNumber: string
  /**
   * 日期选择器：发布日期所在的元素
   */
  date: string
  /**
   * 路径日期（浏览历史的 path_date）从哪来：
   * - `dateText`：把日期选择器的文本解析成 PATH_DATE（javdb）
   * - `href`：取日期选择器上的 href —— 有的站点日期写在链接里（onejav）
   * - 不填：本页拿不到，由站点在详情页回调里补（javstore）
   */
  pathDateFrom?: 'dateText' | 'href'
  /**
   * 链接选择器
   */
  link: string
  /**
   * 标题选择器（可选，解析画廊标题等场景使用）
   */
  title?: string
  /**
   * 列表自带缩略图（可选）：为 true 时瀑布流直接追加原条目，跳过站点缩略图解析
   */
  nativeThumbnail?: boolean
}

class Lock {
  locked: boolean

  constructor(locked: boolean = false) {
    this.locked = locked
  }

  lock() {
    this.locked = true
  }

  unlock() {
    this.locked = false
  }
}
