import {GM_getValue} from "$";
import {SiteAbstract} from "../site/site-abstract";
import $ from "jquery";
import {Sisters} from "../site/sisters";
import {Pagination} from "./pagination";

export default class {

	private lock: Lock = new Lock();

	private baseURI: string = this.getBaseURI();

	private selector: Selector;

	private readonly anchor: HTMLElement | null = null;

	public page: Pagination;

	private site: SiteAbstract;

	private sisters: Sisters;

	constructor(site: SiteAbstract, selector: Selector, sisters: Sisters) {
		this.site = site
		this.selector = selector
		this.page = new Pagination(this.getDetail(document))
		const $pageNation = $(this.selector.pagination);
		if ($pageNation.length > 0) {
			this.anchor = $pageNation[0];
		}
		this.sisters = sisters;
	}

	flow(defaultValue: number = 1, oneStep: boolean = false) {
		this.site.findImages(this.page.detail);
		if ($(this.selector.item).length) {
			const waterfallScrollStatus = GM_getValue('waterfallScrollStatus', 1);
			// 开启关闭瀑布流判断
			if (waterfallScrollStatus > 0) {
				this.setSisterNumber()
				this.loadNext(oneStep)
			}
		}
	}

	flowOneStep() {
		this.flow(2, true)
	}

	loadNext(oneStep = false) {
		console.log(`===加载下一页===`)

		let nextUrl = this.getNextUrl(document);
		if (nextUrl === null) {
			// TODO: 2022/12/28
			this.isEnd();
			console.log('===当前已经是最后一页===')
			return
		}
		this.page.nextUrl = nextUrl;
		this.fetchNextSync(oneStep);
	}

	private isEnd() {
		this.page.isEnd = true;
		this.site.loadCompleted()
	}

	private getBaseURI() {
		let _ = location
		return `${_.protocol}//${_.hostname}${(_.port && `:${_.port}`)}`
	}

	private fetchNextSync(oneStep: boolean = false) {
		new Promise((resolve, reject) => {
			if (this.lock.locked) {
				reject()
			} else {
				this.lock.lock()
				// console.log('加锁')
				resolve(null)
			}
		}).then(() => {
			return this.fetchURL();
		}).then(() => {
			if (oneStep) {
				this.appendNext(oneStep);
			}
		}).catch((reason) => {
			console.error(reason.message);
			// Locked!
		});
	}

	private async fetchURL(retry = 3): Promise<void> {
		if (this.page.nextUrl === null) {
			this.isEnd()
			console.log(`加载完毕!!!`)
			return Promise.resolve();
		}
		console.log(`fetchUrl = ${this.page.nextUrl}`)
		try {
			let response = await fetch(this.page.nextUrl, {credentials: 'same-origin'});
			let html = await response.text();
			const doc = new DOMParser().parseFromString(html, 'text/html');
			this.page.nextUrl = this.getNextUrl(doc);
			this.page.nextDetail = this.getDetail(doc);
			console.log(`获取下一页图片`);
			this.site.findImages(this.page.nextDetail);
			console.log(`内容遍历完成`);
			return Promise.resolve();
		} catch (reason) {
			console.error(reason);
			if (retry > 0) {
				console.log('重试获取下一页', this.page.nextUrl);
				return this.fetchURL(--retry);
			} else {
				return Promise.resolve();
			}
		}
	}

	private getDetail(doc: Document): JQuery {
		const details = $(doc).find(this.selector.item);
		for (const elem of details) {
			const links = elem.getElementsByTagName('a')
			for (let i = 0; i < links.length; i++) {
				links[i].target = '_blank'
			}
		}
		return details;
	}

	private getNextUrl(doc: Document) {
		const href = $(doc).find(this.selector.next).attr('href')
		const a = document.createElement('a')
		if (href === undefined || href === null) return null
		a.href = href;
		return `${this.baseURI}${a.pathname}${a.search}`
	}

	private end() {
		// $(window).off('scroll');
		if (this.anchor === null) return
		let $end = $(`<h1>The End</h1>`)
		$(this.anchor).replaceWith($end)
	}

	public scroll() {
		return new Promise((resolve, reject) => {
			//窗口高度
			const windowHeight = $(window).height()
			if (windowHeight === undefined) {
				console.log('获取不到窗口高度')
				return Promise.resolve(false)
			}
			//滚动高度
			const scrollTop = $(window).scrollTop();
			if (scrollTop === undefined) {
				console.log('获取不到滚动高度')
				return Promise.resolve(false)
			}
			this.site.scroll(windowHeight, scrollTop);
		});
	}

	appendNext(oneStep: boolean = false) {
		if (this.page.isEnd) {
			console.log(`没有下一页`);
			return this.end();
		}
		if (this.page.nextDetail === null) {
			this.isEnd();
			console.log(`没有获取到下一页内容`);
			return;
		}
		console.log(`加载下一页内容`)
		$(this.selector.container).append(this.page.nextDetail);
		this.setSisterNumber();
		this.page.nextDetail = null;
		// console.log(`解锁`);
		this.lock.unlock()
		return this.fetchNextSync(oneStep);
	}

	private setSisterNumber() {
		const sisterNumber = $(this.selector.item).length;
		console.log('妹妹数量:' + sisterNumber)
		this.sisters.sisterNumber = sisterNumber
	}
}

export declare interface Selector {
	next: string
	item: string
	container: string
	pagination: string
}

class Lock {

	locked: boolean

	constructor(locked: boolean = false) {
		this.locked = locked
	}

	lock() {
		this.locked = true
	}

	unlock() {
		this.locked = false
	}
}
