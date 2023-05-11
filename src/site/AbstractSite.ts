import {Selector} from "../waterfall";
import {SiteInterface} from "./SiteInterface";
import {Sisters} from "./Sisters";

export abstract class AbstractSite implements SiteInterface{

  abstract selector: Selector

  abstract sisters: Sisters;

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

export class LockPool {

  keyPool = new Set<string>();

  lock(key: string) {
    this.keyPool.add(key);
  }

  unlock(key: string) {
    this.keyPool.delete(key);
  }

  locked(key: string) {
    return this.keyPool.has(key);
  }
}
