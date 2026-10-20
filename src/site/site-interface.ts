export interface SiteInterface {
  // 声明抽象的方法，让子类去实现
  mount(): void

  resolveElements(elems: JQuery): Promise<JQuery[]>

  onScrollEvent(windowHeight: number, scrollTop: number): void

  download(checkArchive: boolean): void

  showControlPanel(): boolean

  save(serialNumber: string): void

  loadNext(): void

  getOriginalId(item: JQuery): string | undefined

  /** 瀑布流追加新条目后的回调（可选），站点在这里复用首屏的条目处理逻辑 */
  onItemsAppended?(items: JQuery[]): void | Promise<void>
}
