export interface SiteInterface {
  // 声明抽象的方法，让子类去实现
  mount(): void;

  findImages(elems: JQuery): void;

  scroll(windowHeight: number, scrollTop: number): void;

  previous(): void;

  download(): void;

  nextStep(): void;

  whetherToDisplay(): boolean;

  save(avid:string): void;

  loadNext(): void;
}
