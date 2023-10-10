import Waterfall, {Selector} from "../waterfall";
import {SiteInterface} from "./site-interface";
import {Sisters} from "./sisters";
import {Theme} from "./index";

export abstract class SiteAbstract implements SiteInterface {

	abstract selector: Selector;

	abstract sisters: Sisters;

	abstract waterfall: Waterfall;

	abstract theme: Theme;

	// 声明抽象的方法，让子类去实现
	abstract mount(): void;

	abstract findImages(elems: JQuery): void;

	abstract addPreview($elem: JQuery): void;

	abstract scroll(windowHeight: number, scrollTop: number): void;

	abstract previous(x:any, y:any): void;

	abstract download(): void;

	abstract nextStep(x:any, y:any): void;

	abstract showControlPanel(): boolean;

	abstract save(serialNumber: string): void;

	abstract loadNext(): void;

	abstract loadCompleted(): void;
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
