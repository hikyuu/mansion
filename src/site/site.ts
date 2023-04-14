import {Selector} from "../waterfall";

abstract class Site {

  abstract selector: Selector

  abstract currentPreviewId: string | undefined;

  // 声明抽象的方法，让子类去实现
  abstract mount(): void;

  abstract findImages(elems: JQuery): void;

  abstract scroll(windowHeight: number, scrollTop: number): void;

  abstract previous(): void;

  abstract download(): void;

  abstract nextStep(): void;

  abstract whetherToDisplay(): boolean;

  abstract save(avid:string): void;

  abstract loadNext(): void;

  abstract haveRead(): boolean;
}

export {
  Site
};
