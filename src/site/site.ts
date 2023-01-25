import {Selector} from "../waterfall";
import {getAvCode} from "../common";

abstract class Site {

  abstract selector:Selector

  // 声明抽象的方法，让子类去实现
  abstract mount(): void

  abstract findImages(elems: JQuery) : void

  abstract scroll(windowHeight:number,scrollTop:number):void;
}

export {
  Site
};
