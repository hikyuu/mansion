import { SiteAbstract } from '@/site/site-abstract'
import $ from 'jquery'
import { Sister } from '@/site/sister'
import { Pagination } from './pagination'
import { ElNotification } from 'element-plus'
import { useConfigStore } from '@/store/config-store'
import { WaterfallStatus } from '@/dictionary'
import { reactive } from 'vue'

export default class {
  public page: Pagination
  private lock: Lock = new Lock()
  private baseURI: string = this.getBaseURI()
  private selector: Selector
  private readonly anchor: HTMLElement | null = null
  private site: SiteAbstract
  private sisters: Sister
  private configStore = useConfigStore()
  constructor(site: SiteAbstract, selector: Selector, sisters: Sister) {
    this.site = site
    this.selector = selector
    this.page = reactive(new Pagination(this.getDetail(document)))
    const $pageNation = $(this.selector.pagination)
    if ($pageNation.length > 0) {
      this.anchor = $pageNation[0]
    }
    this.sisters = sisters
  }

  flow(waterfallScrollStatus: number | null = null) {
    if ($(this.selector.item).length <= 0) {
      console.info(`没有妹妹`)
      return
    }
    this.setSisterNumber()
    this.loadPreview(this.page.detail)

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
    this.loadNext(false)
  }

  private flowOneStep() {
    ElNotification({ title: '瀑布流', message: `启动一步到位模式`, type: 'info' })
    this.loadNext(true)
  }

  private loadNext(oneStep = false) {
    console.log(`===加载下一页===`)
    const nextUrl = this.getNextUrl(document)
    if (nextUrl === null) {
      this.isEnd()
      console.log('===当前已经是最后一页===')
      return
    }
    this.page.nextUrl = nextUrl
    this.fetchNextSync(oneStep).then()
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

  appendNext(oneStep: boolean = false) {
    if (this.lock.locked) {
      console.log(`下一页正在加载中`)
      return
    }
    this.fetchNextSync(oneStep).then()
  }

  private appendNextLocal() {
    if (this.page.isEnd) {
      console.log(`没有下一页`)
      return this.end()
    }
    if (this.page.nextDetail === null) {
      console.log(`没有获取到下一页内容`)
      return this.isEnd()
    }
    $(this.selector.container).append(this.page.nextDetail)
    this.setSisterNumber()
    this.page.nextDetail = null
  }

  isEnd() {
    this.page.isEnd = true
    this.site.loadCompleted()
    ElNotification({ title: '提示', message: `瀑布流落地了`, type: 'success' })
  }

  getBaseURI() {
    const _ = location
    return `${_.protocol}//${_.hostname}${_.port && `:${_.port}`}`
  }

  async fetchNextSync(oneStep: boolean = false) {
    if (this.lock.locked) {
      return
    } else {
      this.lock.lock()
    }
    try {
      await this.fetchURL()
      this.appendNextLocal()
      if (!oneStep) {
        const sisterNumber = this.sisters.sisterNumber
        const lazyLimit = useConfigStore().currentConfig.lazyLimit
        const haveReadNumber = this.sisters.queue.filter((item) => item.haveRead).length
        if (sisterNumber - haveReadNumber > lazyLimit) {
          return
        }
      }
      this.lock.unlock()
      if (this.page.isEnd) return
      this.fetchNextSync(oneStep).then()
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
      console.log(`加载下一页预览图`)
      this.loadPreview(this.page.nextDetail)
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
    $(this.selector.item)
    let sisterNumber = $(this.selector.item).length
    if (this.page.nextDetail !== null) {
      sisterNumber += this.page.nextDetail.find(this.selector.item).length
    }
    if (sisterNumber === 0) {
      console.error('没有找到妹妹！')
    }
    this.sisters.sisterNumber = sisterNumber
    return sisterNumber
  }

  private loadPreview(detail: JQuery) {
    if (this.configStore.currentConfig.loadPreviewSwitch) {
      this.site.findImages(detail)
    }
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
