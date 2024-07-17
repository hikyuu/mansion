import { GM_deleteValue } from '$'
import { SiteAbstract } from '@/site/site-abstract'
import $ from 'jquery'
import { Sisters } from '@/site/sisters'
import { Pagination } from './pagination'
import { ElNotification } from 'element-plus'
import { useConfigStore } from '@/store/config-store'

export default class {
  public page: Pagination
  private lock: Lock = new Lock()
  private baseURI: string = this.getBaseURI()
  private selector: Selector
  private readonly anchor: HTMLElement | null = null
  private site: SiteAbstract
  private sisters: Sisters
  private configStore = useConfigStore()
  constructor(site: SiteAbstract, selector: Selector, sisters: Sisters) {
    this.site = site
    this.selector = selector
    this.page = new Pagination(this.getDetail(document))
    const $pageNation = $(this.selector.pagination)
    if ($pageNation.length > 0) {
      this.anchor = $pageNation[0]
    }
    this.sisters = sisters
    GM_deleteValue('waterfallScrollStatus')
    GM_deleteValue('whetherToLoadPreview')
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
      case 0:
        ElNotification({ title: '瀑布流', message: `瀑布流已关闭`, type: 'info' })
        break
      case 1:
        this.flowLazy()
        break
      case 2:
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

  async appendNext(oneStep: boolean = false) {
    if (this.page.isEnd.value) {
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
    // console.log(`解锁`);
    this.lock.unlock()
    return this.fetchNextSync(oneStep)
  }

  isEnd() {
    this.page.isEnd.value = true
    this.site.loadCompleted()
    ElNotification({ title: '提示', message: `加载完毕!!!`, type: 'success' })
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
      if (!oneStep) {
        return
      }
      this.appendNext(oneStep).then()
    } catch (e) {
      // Locked!
      console.error(e)
    }
  }

  async fetchURL(retry = 3): Promise<void> {
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
    const sisterNumber = $(this.selector.item).length
    if (sisterNumber === 0) {
      console.error('没有找到妹妹！')
    }
    this.sisters.sisterNumber = sisterNumber
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
