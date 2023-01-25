import {GM_getValue} from "$";
import {Site} from "../site/site";
import $ from "jquery";
import {dictionary} from "../dictionary";
import {toRaw} from "vue";

class Pagination {
  currentURL: string = location.toString()
  isEnd: boolean = false
  nextUrl: string | null = null
  detail: JQuery | null = null;
  nextDetail: JQuery | null = null
}

export default class {

  private lock: Lock = new Lock();

  private baseURI: string = this.getBaseURI();

  private selector: Selector = new Selector();

  private readonly anchor: HTMLElement | null = null;

  private page: Pagination = new Pagination();

  private site: Site;

  constructor(site: Site, selector: Selector) {
    this.site = site
    this.selector = selector
    this.page.detail = this.getDetail(document);
    const htmlElements = $(this.selector.pagination);
    if (htmlElements.length > 0) {
      this.anchor = $(this.selector.pagination)[0];
    }
  }

  flow() {

    if ($(this.selector.item).length) {

      const waterfallScrollStatus = GM_getValue('waterfallScrollStatus', 1);

      // 开启关闭瀑布流判断
      if (waterfallScrollStatus > 0) {

        $(window).on('scroll', () => this.scroll());

        this.loadNext()
      }
    }
  }

  private loadNext() {
    console.log(`===加载下一页===`)
    this.page.detail = this.getDetail(document);

    this.site.findImages(this.page.detail);

    let nextUrl = this.getNextUrl(document);
    if (nextUrl === null) {
      // TODO: 2022/12/28
      this.page.isEnd = true;
      console.log('===当前已经是最后一页===')
      return
    }
    this.page.nextUrl = nextUrl;
    this.fetchNextSync()
  }

  // private appendElems() {
  //   // let nextPage = this.pageIterator.next()
  //   if (!nextPage.done) {
  //     nextPage.value.then(elems => {
  //       const cb = (this.count === 0) ? this._1func : this._2func
  //       cb($(this.selector.container), elems)
  //       this.count += 1
  //       // hobby mod script
  //       this._3func(elems)
  //       this._4func(elems)
  //     })
  //   }
  //   return nextPage.done
  // }

  // _2func(cont, elems) {
  //   cont.append(elems)
  // }

  private getBaseURI() {
    let _ = location
    return `${_.protocol}//${_.hostname}${(_.port && `:${_.port}`)}`
  }

  private fetchNextSync() {
    // TODO: 2022/12/28 重试机制
    //第一次为location.href
    new Promise((resolve, reject) => {
      if (this.lock.locked) {
        reject()
      } else {
        this.lock.lock()
        console.log('加锁', this.page)
        resolve(null)
      }
    }).then(() => {
      return this.fetchURL().then();
    }).catch((err) => {
      // Locked!
    });
  }

  private fetchURL() {
    console.log(`fetchUrl = ${this.page.nextUrl}`)
    if (this.page.nextUrl === null) throw Error('fetchUrl为空')
    const fetchWithCookie = fetch(this.page.nextUrl, {credentials: 'same-origin'});
    return fetchWithCookie.then(response => response.text())
      .then(html => new DOMParser().parseFromString(html, 'text/html'))
      .then(doc => {
        let nextUrl = this.getNextUrl(doc);
        if (nextUrl === null) {
          this.page.isEnd = true;
        }
        this.page.nextUrl = nextUrl

        this.page.nextDetail = this.getDetail(doc);

        this.site.findImages(this.page.nextDetail);
        // javdb列表 bug：一直有最后一页 console.log(`1 ${url}`);console.log(`2 ${nextURL}`);
        // if ($(JAVDB_ITEM_SELECTOR).length && (this.count !== 0) && url === nextURL) {
        //   if ($(`#waterfall > div > a[href="${$(elems[0]).find('a.box')[0].attr('href')}"]`).length > 0) {
        //     nextURL = undefined
        //     elems = []
        //   }
        // }
      }).catch((reason) => {

      })
  }

  private getDetail(doc: Document): JQuery {
    const detail = $(doc).find(this.selector.item);
    for (const elem of detail) {
      const links = elem.getElementsByTagName('a')
      for (let i = 0; i < links.length; i++) {
        links[i].target = '_blank'
      }
    }
    return detail;
  }

  private getNextUrl(doc: Document) {
    const href = $(doc).find(this.selector.next).attr('href')
    const a = document.createElement('a')
    if (href === undefined || href === null) return null
    a.href = href;
    return `${this.baseURI}${a.pathname}${a.search}`
  }

  private end() {
    $(window).off('scroll');
    if (this.anchor === null) return
    let $end = $(`<h1>The End</h1>`)
    $(this.anchor).replaceWith($end)
  }

  private scroll() {
    // console.log('滚动')
    //窗口给高度
    const windowHeight = $(window).height()
    if (windowHeight === undefined) {
      console.log('获取不到窗口高度')
      return false
    }
    //滚动高度
    const scrollTop = $(window).scrollTop();
    if (scrollTop === undefined) {
      console.log('获取不到滚动高度')
      return false
    }
    this.site.scroll(windowHeight, scrollTop);
    if (this.reachBottom(windowHeight, 500)) {
      this.appendNext();
    }

  }

  private reachBottom(height: number, limit: number) {
    if (this.anchor === null) {
      console.log('找不到分页栏')
      return false
    }
    return (this.anchor.getBoundingClientRect().top - height) < limit;
  }


  private appendNext() {
    console.log(`到达底部`)
    if (this.page.isEnd) {
      console.log(`没有下一页`);
      return this.end();
    }
    if (this.page.nextDetail === null) {
      console.log(`没有获取到下一页内容`);
      return
    }
    $(this.selector.container).append(this.page.nextDetail);
    console.log(`解锁`);
    this.lock.unlock()
    return this.fetchNextSync();
  }
}

class Selector {
  public next: string = 'a.next'
  public item: string = ''
  public container: string = '#waterfall'
  public pagination: string = '.pagination'
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

export {
  Selector
};
