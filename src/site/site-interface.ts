export interface SiteInterface {
  // 声明抽象的方法，让子类去实现
  mount(): void

  resolveElements(elems: JQuery): Promise<JQuery[]>

  onScrollEvent(windowHeight: number, scrollTop: number): void

  download(): void

  showControlPanel(): boolean

  save(serialNumber: string): void

  loadNext(): void
}
