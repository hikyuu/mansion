import { GM_getValue } from '$'
import { SiteAbstract } from '@/site/site-abstract'
import $ from 'jquery'
import { Sisters } from '@/site/sisters'
import { Pagination } from './pagination'
import { ElNotification } from 'element-plus'

export default class {
  public page: Pagination
  public waterfallScrollStatus = GM_getValue('waterfallScrollStatus', 0)
  public whetherToLoadPreview = GM_getValue('whetherToLoadPreview', false)
  private lock: Lock = new Lock()
  private baseURI: string = this.getBaseURI()
  private selector: Selector
  private readonly anchor: HTMLElement | null = null
  private site: SiteAbstract
  private sisters: Sisters
  constructor(site: SiteAbstract, selector: Selector, sisters: Sisters) {
    this.site = site
    this.selector = selector
    this.page = new Pagination(this.getDetail(document))
    const $pageNation = $(this.selector.pagination)
    if ($pageNation.length > 0) {
      this.anchor = $pageNation[0]
    }
    this.sisters = sisters
  }

  flow() {
    if ($(this.selector.item).length <= 0) {
      console.info(`没有妹妹`)
      return
    }
    this.loadPreview(this.page.detail)
    this.setSisterNumber()
    switch (this.waterfallScrollStatus) {
      case 0:
        ElNotification({ title: '瀑布流', message: `瀑布流已关闭`, type: 'info' })
        break
      case 1:
        this.flowLazy()
        break
      case 2:
        this.flowOneStep()
    }
  }

  flowLazy() {
    ElNotification({ title: '瀑布流', message: `启动懒加载`, type: 'info' })
    this.loadNext(false)
  }

  flowOneStep() {
    ElNotification({ title: '瀑布流', message: `启动一步到位模式`, type: 'info' })
    this.loadNext(true)
  }

  loadNext(oneStep = false) {
    console.log(`===加载下一页===`)

    const nextUrl = this.getNextUrl(document)
    if (nextUrl === null) {
      // TODO: 2022/12/28
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
    // console.log(`解锁`);
    this.lock.unlock()
    return this.fetchNextSync(oneStep)
  }

  isEnd() {
    this.page.isEnd = true
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
    // console.log('妹妹数量:' + sisterNumber)
    this.sisters.sisterNumber = sisterNumber
  }

  private loadPreview(detail: JQuery) {
    if (this.whetherToLoadPreview) {
      this.site.findImages(detail)
    }
  }
}

export declare interface Selector {
  next: string
  item: string
  container: string
  pagination: string
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
