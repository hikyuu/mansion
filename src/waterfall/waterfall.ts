import { SiteAbstract } from '@/site/site-abstract'
import $ from 'jquery'
import { Pagination } from './pagination'
import { ElNotification } from 'element-plus'
import { useConfigStore } from '@/store/config-store'
import { WaterfallStatus } from '@/dictionary'
import { reactive } from 'vue'
import { useSisterStore } from '@/store/sister-store'

const allReadPageLimit = 5

export default class {
  public page: Pagination
  private lock: Lock = new Lock()
  private baseURI: string = this.getBaseURI()
  private selector: Selector
  private readonly anchor: HTMLElement | null = null
  private site: SiteAbstract
  private configStore = useConfigStore()
  private allReadedPage: number = 0

  constructor(site: SiteAbstract, selector: Selector) {
    this.site = site
    this.selector = selector
    this.page = reactive(new Pagination(this.getDetail(document)))
    const $pageNation = $(this.selector.pagination)
    if ($pageNation.length > 0) {
      this.anchor = $pageNation[0]
    }
  }

  async flow(waterfallScrollStatus: number | null = null) {
    if ($(this.selector.item).length <= 0) {
      console.info(`没有妹妹`)
      return
    }
    await this.loadThumbnail(this.page.detail)
    this.setSisterNumber()

    if (waterfallScrollStatus == null) {
      waterfallScrollStatus = this.configStore.currentConfig.scrollStatus
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
    console.log(`===加载下一页===`)
    const nextUrl = this.getNextUrl(document)
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
    const windowHeight = $(window).height()
    if (windowHeight === undefined) {
      console.log('获取不到窗口高度')
      return false
    }
    //滚动高度
    const scrollTop = $(window).scrollTop()
    if (scrollTop === undefined) {
      console.log('获取不到滚动高度')
      return false
    }
    this.site.onScrollEvent(windowHeight, scrollTop)
    return true
  }

  async appendNext(oneStep: boolean = false) {
    if (this.lock.locked) {
      console.log(`下一页正在加载中`)
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
      $(this.selector.container).append(items)
      this.setSisterNumber()
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
    this.site.allLoadCompleted()
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
      await this.fetchURL()
      await this.appendNextLocal()
      if (!oneStep) {
        const sisterNumber = useSisterStore().sisterNumber
        const lazyLimit = useConfigStore().currentConfig.lazyLimit
        if (sisterNumber - useSisterStore().haveReadNumber > lazyLimit) {
          return
        }
      }
      this.lock.unlock()
      if (this.page.isEnd) return
      await this.fetchNextSync(oneStep)
    } catch (e) {
      console.error(e)
    } finally {
      this.lock.unlock()
    }
  }

  async fetchURL(retry = 3): Promise<void> {
    if (this.page.isEnd) return
    if (this.page.nextUrl === null) {
      return this.isEnd()
    }
    try {
      const response = await fetch(this.page.nextUrl, { credentials: 'same-origin' })
      if (!response.ok) {
        console.log('重试获取下一页:状态错误', this.page.nextUrl)
        return this.fetchURL(--retry)
      }
      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      this.page.nextUrl = this.getNextUrl(doc)
      this.page.nextDetail = this.getDetail(doc)
    } catch (reason) {
      console.error(reason)
      if (retry > 0) {
        console.log('重试获取下一页:报错', this.page.nextUrl)
        return this.fetchURL(--retry)
      } else {
        console.log('重试次数用尽')
      }
    }
  }

  getDetail(doc: Document): JQuery {
    const details = $(doc).find(this.selector.item)
    for (const elem of details) {
      const links = elem.getElementsByTagName('a')
      for (let i = 0; i < links.length; i++) {
        links[i].target = '_blank'
      }
    }
    return details
  }

  getNextUrl(doc: Document) {
    const href = $(doc).find(this.selector.next).attr('href')
    const a = document.createElement('a')
    if (href === undefined || href === null) return null
    a.href = href
    return `${this.baseURI}${a.pathname}${a.search}`
  }

  end() {
    // $(window).off('scroll');
    if (this.anchor === null) return
    const $end = $(`<h1>The End</h1>`)
    $(this.anchor).replaceWith($end)
  }

  setSisterNumber() {
    const sisterNumber = $(this.selector.item).length
    if (sisterNumber === 0) {
      console.error('没有找到妹妹！')
    }
    useSisterStore().sisterNumber = sisterNumber
    return sisterNumber
  }

  private async loadThumbnail(detail: JQuery) {
    if (this.configStore.currentConfig.loadThumbnailSwitch) {
      return await this.site.resolveElements(detail)
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
   * 日期选择器
   */
  date: string
  /**
   * 路径日期选择器
   */
  pathDate: string
  /**
   * 链接选择器
   */
  link: string
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
