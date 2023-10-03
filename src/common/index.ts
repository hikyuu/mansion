import {GM_deleteValue, GM_getValue, GM_xmlhttpRequest} from "vite-plugin-monkey/dist/client";
import {error} from "jquery";
import {picx} from "../dictionary";

export function getAvCode(avid: string): string {
	// 带-的番号不处理，除了-0 如：DSVR-01167
	if (avid.match(/-[^0]/g)) return avid
	// 999999_001,999999-001 不处理
	if (avid.match(/^[0-9-_]+$/g)) return avid
	// crazyasia99999,sm999,video_999,BrazzersExxtra.99.99.99 不处理
	if (avid.match(/^(crazyasia|sm|video_|BrazzersExxtra)+/gi)) return avid
	let letter = avid.match(/[a-z|A-Z]+/gi)
	let nums = avid.match(/\d+$/gi)
	if (nums === null) throw new Error('没匹配到番号');
	let num = nums[0];
	if (num.length > 3) {
		num = num.replace(/\b(0+)/gi, ''); //去除开头的0
		if (num.length < 3) {
			num = (Array(3).join('0') + num).slice(-3)
		}
	}
	if (letter === null) {
		throw error('没匹配到番号');
	}
	return letter.toString().replace(/,/g, '-') + '-' + num;
}

export function getPreviewElement(avid: string, targetImgUrl: string, isZoom: boolean) {
	// console.log('显示的图片地址:' + targetImgUrl)
	//创建img元素,加载目标图片地址
	//创建新img元素
	let className = 'max'
	if (isZoom != undefined && !isZoom) {
		className = 'min'
	}
	let $img = $(`<div id='preview'><img id="IMG_${avid}" title="点击可放大缩小 (图片正常时)" class="${className}"/></div>`)
	$img.css({'text-align': 'center'});
	$img.children(`#IMG_${avid}`)
		.attr('src', targetImgUrl)
		.attr('retry', 0)
		.on('click', function () {
			if ($(this).hasClass('max')) {
				$(this).attr('class', 'min')
				if (this.parentElement) {
					if (this.parentElement.parentElement) {
						this.parentElement.parentElement.scrollIntoView()
					}
				}
			} else {
				$(this).attr('class', 'max')
			}
		}).on('error', function () {
		console.log('图片加载失败,重试中...')
		let retryString = $(this).attr("retry");
		if (retryString === undefined) return
		let retry = Number(retryString);
		setTimeout(() => {
			if (retry > 3) {
				$(this).attr("src", picx("/failed.svg"));//设置碎图
				// $(this).css('width', 200).css('height', 200);
			} else {
				$(this).attr("retry", retry++);//重试次数+1
				$(this).attr('src', targetImgUrl);//继续刷新图片
			}
		}, 5000)

	});
	return $img;
}

export function getJavstoreUrl(avid: string, retry = 1): Promise<string | null> {
	//异步请求搜索JavStore的番号
	return request(`https://javstore.net/search/${avid}.html`).then((result) => {
		let overview = parseText(result.responseText);
		// 查找包含avid番号的a标签数组,忽略大小写
		let a_array = $(overview).find(`.news_1n li h3 span a`);
		// console.log(a_array)
		let a = a_array[0]
		//如果找到全高清大图优先获取全高清的
		for (let i = 0; i < a_array.length; i++) {
			// 筛选匹配的番号数据  FC2-PPV-9999999 => 正则/FC2.*PPV.*9999999/gi
			let reg = RegExp(avid.replace(/-/g, '.*'), 'gi')
			if (a_array[i].title.search(reg) > 0) {
				if (!a) a = a_array[i]
				let fhd_idx = a_array[i].title.search(/Uncensored|FHD/i)
				if (fhd_idx >= 0) {
					a = a_array[i]
					break
				}
			}
		}
		if (a) {
			return Promise.resolve(a.getAttribute('href'));
		} else {
			return Promise.resolve(null)
		}
	}).catch(reason => {
		console.error(reason);
		if (retry > 0) {
			console.log('重试获取搜索结果', avid);
			return getJavstoreUrl(avid, retry--);
		} else {
			return Promise.resolve(null);
		}
	})
}

async function getImgUrlFromPixhost(javUrl: string, retry: number = 3): Promise<string | undefined> {
	try {
		let response = await request(javUrl, 'https://javstore.net/')
		return $(response.responseText).find('#image').attr('src');
	} catch (reason) {
		console.error(reason);
		if (retry > 0) {
			console.log('重试Pixhost图片链接', javUrl);
			return getImgUrlFromPixhost(javUrl, retry--);
		} else {
			return undefined;
		}
	}
}

export function getPreviewUrlFromJavStore(javstore: string, avid: string, retry = 1): Promise<any> {

	//异步请求调用内页详情的访问地址
	return request(javstore, 'https://javstore.net/').then(async (result) => {
		let detail = parseText(result.responseText);
		let img_array = $(detail).find('.news a img[alt*=".th"]');
		// console.log('原方法找到', img_array.length)

		let imgUrl: string | undefined = undefined;

		//新方法
		if (img_array.length <= 0) {
			img_array = $(detail).find('.news > a');
			// console.log(`新方法找到`, img_array.length)
			if (img_array.length > 0) {
				const javUrl = img_array[0].getAttribute('href');
				//如果 javUrl不是以http开头的,则返回null
				if (javUrl === null) return Promise.resolve(null);
				console.log(avid+' javstore获取的图片地址:' + javUrl)
				imgUrl = javUrl
				if (javUrl.match(/(pixhost)/gi)) {
					imgUrl = await getImgUrlFromPixhost(javUrl)
					console.log(avid+' pixhost获取的图片地址:' + imgUrl)
				}
			}
			//原方法
		} else {
			// @ts-ignore
			imgUrl = img_array[img_array.length - 1].src
			imgUrl = imgUrl ? imgUrl : img_array[0].dataset.src
			if (imgUrl === undefined) return Promise.resolve(null);
			imgUrl = imgUrl.replace('pixhost.org', 'pixhost.to')
				.replace('.th', '')
				.replace('thumbs', 'images').replace('//t', '//img')
				.replace(/[?*"]/, '')
			// console.log('javstore获取的图片地址:' + imgUrl)
		}

		if (!imgUrl) return Promise.resolve(null);

		const array = imgUrl.match(/(http:\/\/|https:\/\/)((\w|=|\?|\.|\/|&|-)+)/gi);

		if (!array || array.length <= 0) {
			return Promise.resolve(null);
		}
		const url = array.pop();
		if (url === undefined) return Promise.resolve(null);
		return Promise.resolve(url);
	}).catch(reason => {
		console.error(reason);
		if (retry > 0) {
			console.log('重试获取图片 avid:', avid)
			return getPreviewUrlFromJavStore(javstore, avid, retry--);
		}
	});
}

function requestGM_XHR(details: {
	headers: { referrer: any };
	method: 'GET' | 'HEAD' | 'POST';
	url: any;
	timeout: number
}) {
	return new Promise((resolve, reject) => {
		console.log(`发起网址请求：${details.url}`)
		let req = GM_xmlhttpRequest({
			method: details.method ? details.method : 'GET',
			url: details.url,
			headers: details.headers,
			timeout: details.timeout > 0 ? details.timeout : 20000,
			onprogress: rsp => {
				// @ts-ignore
				if (details.onprogress && details.onprogress(rsp)) {
					resolve(rsp)
					req.abort()
				}
			},
			onload: rsp => resolve(rsp),
			onerror: rsp => {
				console.log(`${details.url} : error`)
				reject(`error`)
			},
			ontimeout: () => {
				console.log(`${details.url} ${details.timeout > 0 ? details.timeout : 20000}ms timeout`)
				reject(`timeout`)
			}
		})
	})
}

function request(url: string, referrerStr: string = '', timeoutInt: number = -1) {

	let cookie = ''
	if (url.match(/(pixhost)/gi)) {
		cookie = 'pixhostads=1'
	}

	return new Promise<any>((resolve, reject) => {
		// console.log(`发起网址请求：${url}`)
		GM_xmlhttpRequest({
			url,
			method: 'GET',
			headers: {
				'Cache-Control': 'no-cache',
				Referer: referrerStr,
				Cookie: cookie
			},
			timeout: timeoutInt > 0 ? timeoutInt : 10000,
			onload: response => {
				//console.log(url + " reqTime:" + (new Date() - time1));
				resolve(response)
			},
			onabort: () => {
				reject('请求中止');
			},
			onerror: response => {
				console.log(url + ' error')
				reject('请求出错')
			},
			ontimeout: () => {
				reject(`${timeoutInt > 0 ? timeoutInt : 10000}ms timeout`);
			}
		})
	})
}

function parseText(text: string): Document {
	try {
		let doc = document.implementation.createHTMLDocument('')
		doc.documentElement.innerHTML = text
		return doc
	} catch (e) {
		alert('parse error')
		throw Error('parse error')
	}
}

export function getId() {
	return Math.random().toString(36).substring(3)
}



