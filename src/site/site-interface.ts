export interface SiteInterface {
  // 声明抽象的方法，让子类去实现
  mount(): void

  findImages(elems: JQuery): void

  onScrollEvent(windowHeight: number, scrollTop: number): void

  previous(x: any, y: any): void

  download(): void

  nextStep(x: any, y: any): void

  showControlPanel(): boolean

  save(serialNumber: string): void

  loadNext(): void
}
