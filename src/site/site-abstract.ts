import type { Selector } from '@/waterfall/waterfall'
import type Waterfall from '../waterfall/waterfall'
import type { Theme } from '@/site/site'
import type { Ref } from 'vue'
import { THUMBNAIL_ID } from '@/common/common'
import { parseSister } from '@/site/sister-entry'
import jquery from 'jquery'
import { getHistories } from '@/dao/browse-history'
import { useSisterStore } from '@/store/sister-store'
import { useTaskStore } from '@/store/task-store.ts'
import { SiteId } from '@/site/site-id'
import { useConfigStore } from '@/store/config-store.ts'
import { ThumbnailPipeline } from '@/site/thumbnail-pipeline'

export abstract class SiteAbstract {
  hasLoadCompleted = false

  protected sister = useSisterStore()

  /** 缩略图链路（判档 → 搜索 → 详情 → 大图）统一由 pipeline 执行，站点只提供钩子 */
  protected readonly pipeline = new ThumbnailPipeline(this)

  /**
   * 用户主动按键导航时设为 true，抑制 onScrollEvent 覆盖 current_index。
   * 由 ms-control-panel 的 onStop 回调在 onScrollEvent 执行后调用 endUserNavigating() 复位。
   */
  private _userNavigating = false

  /** 设置用户导航状态，阻止滚动事件覆盖当前索引 */
  public setUserNavigating() {
    this._userNavigating = true
  }

  /** 在 onStop 回调中（onScrollEvent 已执行完毕）调用，恢复正常检测 */
  public endUserNavigating() {
    this._userNavigating = false
  }

  abstract name: string

  abstract siteId: SiteId

  abstract selector: Selector

  abstract waterfall: Waterfall

  abstract theme: Theme

  abstract download(checkArchive: boolean): void

  /** 站点自己的样式。由 mount() 统一调用，站点不必自己记得注入；默认不注入 */
  protected addStyle(): void {
    // 默认无样式
  }

  /**
   * 页面挂载：注入样式 → 启动瀑布流。
   * 需要额外步骤的站点（onejav 的首页监听、exhentai 的队列执行器）覆盖它，
   * 调用 addStyle / enableWaterfall 这两个受保护方法即可，不要重写它们的内部逻辑。
   */
  mount(): void {
    this.addStyle()
    this.enableWaterfall()
  }

  /** 瀑布流启动模式；null = 交给用户配置决定。要让某类页面强制懒加载的站点覆盖它 */
  protected waterfallStatus(): number | null {
    return null
  }

  /** 找到条目容器、打上瀑布流锚点并启动；站点不必自己写这段查 DOM 的样本 */
  protected enableWaterfall(): void {
    const items = jquery(this.selector.container).find(this.selector.item)
    if (items.length === 0) return
    const parent = items[0]?.parentElement
    if (!parent) {
      console.log('当前页面有变动,通知开发者')
      return
    }
    parent.id = 'waterfall'
    this.waterfall.flow(this.waterfallStatus()).then()
  }

  /** 过滤已读 → 入队。列表自带缩略图的站点（exhentai）覆盖它 */
  async resolveElements(elems: JQuery): Promise<JQuery[]> {
    const items = await this.filterReaded(elems)
    useTaskStore().addTasks(items)
    return items
  }

  /** 页面上有妹妹列表才显示控制面板；判据不同的站点覆盖它 */
  showControlPanel(): boolean {
    return jquery(this.selector.container).length > 0
  }

  /** 瀑布流落地。有收尾动作的站点覆盖它并调用 super */
  allLoadCompleted(): void {
    this.hasLoadCompleted = true
  }

  /**
   * 瀑布流追加新条目后的回调（默认空实现）
   * 站点在这里复用首屏的条目处理逻辑，避免追加内容成为"裸 DOM"
   */
  onItemsAppended(_items: JQuery[]): void | Promise<void> {
    // 默认不处理
  }

  infoLoadCompleted(serialNumber: string) {
    useSisterStore().updateInfo({ serialNumber, loadCompleted: true })
  }

  scrollToCurrent(x: Ref<number>, y: Ref<number>): void {
    this.setUserNavigating()
    let prev = jquery('#' + useSisterStore().current_key)
    switch (useConfigStore().getSiteConfig.navigationPoint) {
      case 1:
        prev = prev.find(`#${THUMBNAIL_ID}`)
        break
    }
    if (prev.length === 0) return
    const offset = prev.offset()
    if (offset === undefined) return
    y.value = offset.top - 52
  }

  async loadNext() {
    await this.waterfall.appendNext()
  }

  protected getCurrentWindowElement(detail: JQuery, scrollTop: number) {
    // 用户通过方向键主动导航时，抑制滚动事件覆盖 current_index
    if (this._userNavigating) return

    const detailTop = detail.offset()?.top
    if (detailTop === undefined) return
    const detailHeight = detail.height()
    if (detailHeight === undefined) return
    //当前页面顶部位置大于等于元素的顶部位置并且小于元素的底部位置
    if (scrollTop >= detailTop - 60 && detailTop + detailHeight > scrollTop) {
      const serialNumber = detail.attr('id')
      if (!serialNumber || useSisterStore().current_key === serialNumber) {
        return
      }
      useSisterStore().setCurrent(serialNumber)
    }
  }

  onScrollEvent(windowHeight: number, scrollTop: number) {
    const details = jquery(this.selector.container).find(this.selector.item)
    if (details.length === 0) {
      console.error('滚动事件：没有找到妹妹')
      return
    }
    for (const detail of details) {
      this.getCurrentWindowElement(jquery(detail), scrollTop)
    }
  }

  /** 缩略图链路的具体步骤在 ThumbnailPipeline 内 */
  processThumbnail(serialNumber: string, item: JQuery, type = 0, onlyInfo = false): Promise<void> {
    return this.pipeline.processThumbnail(serialNumber, item, type, onlyInfo)
  }

  async filterReaded(elems: JQuery): Promise<JQuery[]> {
    if (!useConfigStore().getSiteConfig.skipRead) {
      const items = new Array<JQuery>()
      elems.each((index, elem) => {
        items.push(jquery(elem))
      })
      return items
    }
    const itemMap = new Map<string, JQuery>()
    elems.each((index, elem) => {
      const item = jquery(elem)
      const entry = parseSister(item, this.selector)
      if (entry === undefined) return
      itemMap.set(entry.serialNumber, item)
    })
    const keys = Array.from(itemMap.keys())
    const historyDtos = await getHistories(keys)
    historyDtos.forEach((item) => {
      const node = itemMap.get(item.serial_number)
      if (node) {
        node.remove()
        itemMap.delete(item.serial_number)
      }
    })
    return Array.from(itemMap.values())
  }

}
