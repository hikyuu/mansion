import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/index'
import Waterfall from '@/waterfall/index'
import type { Sisters } from '@/site/sisters'
import { loginApiKey } from '@/site/realm'
import $ from 'jquery'
import { Task } from '@/site/task'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { useConfigStore } from '@/store/config-store'

export class Javdb extends SiteAbstract {
  public name = 'javdb'
  public waterfall: Waterfall
  public sisters: Sisters
  constructor(sisters: Sisters) {
    super()
    this.sisters = sisters
    this.waterfall = new Waterfall(this, this.selector, sisters)
  }
  private task: Task = new Task(this)
  selector: Selector = {
    next: 'a.pagination-next',
    container: 'div.movie-list.h.cols-4.vcols-8',
    item: 'div.item',
    pagination: 'nav.pagination',
    serialNumber: 'div.video-title strong',
    date: 'div.meta',
    pathDate: 'div.meta'
  }

  theme = {
    PRIMARY_COLOR: '#2f7feb'
  }

  mount(): void {
    this.addStyle()
    this.enableWaterfall()
    loginApiKey().then(() => {})
  }

  checkSite(): boolean {
    return /(javdb)/g.test(document.URL)
  }

  private addStyle() {
    if (!useConfigStore().currentConfig.loadPreviewSwitch) {
      return
    }
    GM_addStyle(`.movie-list{display: flex;flex-direction: column;} .max{width:100%} .min{width:100%} 
        .movie-list .item .cover { position: relative; padding-top: 15%; background: white;}`)
    console.log(`样式添加成功`)
  }

  private enableWaterfall() {
    const item = $(this.selector.container).find(this.selector.item)
    if (!item.length) {
      return
    }
    if (item[0].parentElement === null) {
      console.log('当前页面有变动,通知开发者')
      return
    }
    item[0].parentElement.id = 'waterfall'
    this.waterfall.flow(1)
  }

  findImages(elems: JQuery): void {
    if (/(javdb)/g.test(location.href) && elems) {
      for (let index = 0; index < elems.length; index++) {
        this.task.addTask($(elems[index]))
      }
    }
  }

  loadCompleted(): void {}

  download(): void {}

  save(serialNumber: string): void {}

  showControlPanel(): boolean {
    return $(this.selector.container).length > 0
  }
}
