import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { error } from 'jquery'
import { picx } from '@/dictionary'
import { getDetailFromJavStore } from '@/site'

export function getAvCode(serialNumber: string): string {
  // 带-的番号不处理，除了-0 如：DSVR-01167
  if (serialNumber.match(/-[^0]/g)) return serialNumber
  // 999999_001,999999-001 不处理
  if (serialNumber.match(/^[0-9-_]+$/g)) return serialNumber
  // crazyasia99999,sm999,video_999,BrazzersExxtra.99.99.99 不处理
  if (serialNumber.match(/^(crazyasia|sm|video_|BrazzersExxtra)+/gi)) return serialNumber
  const letter = serialNumber.match(/[a-z|A-Z]+/gi)
  const nums = serialNumber.match(/\d+$/gi)
  if (nums === null) throw new Error('没匹配到番号')
  let num = nums[0]
  if (num.length > 3) {
    num = num.replace(/\b(0+)/gi, '') //去除开头的0
    if (num.length < 3) {
      num = (Array(3).join('0') + num).slice(-3)
    }
  }
  if (letter === null) {
    throw error('没匹配到番号')
  }
  return letter.toString().replace(/,/g, '-') + '-' + num
}

export function getPreviewElement(serialNumber: string, targetImgUrl: string[]) {
  // console.log('显示的图片地址:' + targetImgUrl)
  //创建img元素,加载目标图片地址
  //创建新img元素
  const $preview = $('<div>', { id: 'preview' })

  for (let i = 0; i < targetImgUrl.length; i++) {
    const url = targetImgUrl[i]
    const $img = $('<img>', {
      id: `IMG_${i + 1}_${serialNumber}`,
      src: url,
      retry: 0,
      alt: serialNumber,
      style: 'width:100%;'
    })
    $preview.append($img)
  }
  return $preview
}

export function getJavstoreUrl(serialNumber: string, retry = 1): Promise<string | null> {
  //异步请求搜索JavStore的番号
  return request(`https://javstore.net/search/${serialNumber}.html`)
    .then((result) => {
      const overview = parseText(result.responseText)
      // 查找包含番号的a标签数组,忽略大小写
      const a_array = $(overview).find(`.news_1n li h3 span a`)
      // console.log(a_array)
      let a = a_array[0]
      //如果找到全高清大图优先获取全高清的
      for (let i = 0; i < a_array.length; i++) {
        // 筛选匹配的番号数据  FC2-PPV-9999999 => 正则/FC2.*PPV.*9999999/gi
        const reg = RegExp(serialNumber.replace(/-/g, '.*'), 'gi')
        if (a_array[i].title.search(reg) > 0) {
          if (!a) {
            a = a_array[i]
            break
          }
        }
      }
      if (!a) return Promise.resolve(null)
      const href = a.getAttribute('href')
      if (href === null) {
        return Promise.resolve(null)
      }
      if (containsHTML(href)) {
        return Promise.resolve(null)
      }
      return Promise.resolve(href)
    })
    .catch((reason) => {
      console.error(reason)
      if (retry > 0) {
        console.log('重试获取搜索结果', serialNumber)
        return getJavstoreUrl(serialNumber, --retry)
      } else {
        return Promise.resolve(null)
      }
    })
}
function containsHTML(text: string) {
  const regex = /<\/?[a-z][\s\S]*>/i
  return regex.test(text)
}
export async function getImgUrlFromPixhost(javUrl: string, retry: number = 3): Promise<string | undefined> {
  try {
    const response = await request(javUrl, 'https://javstore.net/')
    return $(response.responseText).find('#image').attr('src')
  } catch (reason) {
    console.error(reason)
    if (retry > 0) {
      console.log('重试Pixhost图片链接', javUrl)
      return getImgUrlFromPixhost(javUrl, --retry)
    } else {
      return undefined
    }
  }
}

export async function getPreviewUrlFromJavStore(javstore: string, serialNumber: string, retry = 3) {
  //异步请求调用内页详情的访问地址
  try {
    const detail = await getDetailFromJavStore(javstore)
    if (!detail) return null
    let img_array = $(detail).find('.news a img[alt*=".th"]')
    // console.log('原方法找到', img_array.length)

    let imgUrl: string | undefined = undefined

    //新方法
    if (img_array.length <= 0) {
      img_array = $(detail).find('.news > a')
      // console.log(`新方法找到`, img_array.length)
      if (img_array.length <= 0) return null
      const javUrl = img_array[0].getAttribute('href')
      //如果 javUrl不是以http开头的,则返回null
      if (javUrl === null) return null
      // console.log(serialNumber+' javstore获取的图片地址:' + javUrl)
      imgUrl = javUrl
      if (javUrl.match(/(pixhost)/gi)) {
        imgUrl = await getImgUrlFromPixhost(javUrl)
        console.log(serialNumber + ' pixhost获取的图片地址:' + imgUrl)
      }
      //原方法
    } else {
      // @ts-ignore
      imgUrl = img_array[img_array.length - 1].src
      imgUrl = imgUrl ? imgUrl : img_array[0].dataset.src
      if (imgUrl === undefined) return null
      imgUrl = imgUrl
        .replace('pixhost.org', 'pixhost.to')
        .replace('.th', '')
        .replace('thumbs', 'images')
        .replace('//t', '//img')
        .replace(/[?*"]/, '')
      // console.log('javstore获取的图片地址:' + imgUrl)
    }

    if (!imgUrl) return null

    const array = imgUrl.match(/(http:\/\/|https:\/\/)((\w|=|\?|\.|\/|&|-)+)/gi)

    if (!array || array.length <= 0) {
      return null
    }
    const url = array.pop()
    if (url === undefined) return null
    return url
  } catch (reason) {
    console.error(reason)
    return null
  }
}
export function request(url: string, referer: string = '', timeoutInt: number = -1) {
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
        Referer: referer,
        Cookie: cookie
      },
      timeout: timeoutInt > 0 ? timeoutInt : 30000,
      onload: (response) => {
        //console.log(url + " reqTime:" + (new Date() - time1));
        resolve(response)
      },
      onabort: () => {
        reject('请求中止')
      },
      onerror: (reason) => {
        console.log(url + ' error')
        reject('请求出错')
      },
      ontimeout: () => {
        reject(`${timeoutInt > 0 ? timeoutInt : 30000}ms timeout`)
      }
    })
  })
}

export function parseText(text: string): Document {
  try {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.innerHTML = text
    return doc
  } catch (e) {
    alert('parse error')
    throw Error('parse error')
  }
}

function alphaNumber(originalId: string) {
  const cuttingNumber = originalId.matchAll(/(^[a-z].*[a-z])(\d+)/gi)
  const numberArray = Array.from(cuttingNumber)
  // console.dir(numberArray)
  if (numberArray.length === 0) return originalId
  return numberArray[0][1] + '-' + numberArray[0][2]
}

function fc2_ppv(originalId: string) {
  const cuttingNumber = originalId.matchAll(/(heyzo|FC2PPV)(\d+)/gi)
  const numberArray = Array.from(cuttingNumber)
  // console.log('numberArray', numberArray)
  if (numberArray.length > 0) {
    const reg = /(FC2PPV)(\d+)/gi
    if (reg.test(originalId)) {
      return 'FC2-PPV-' + numberArray[0][2]
    }
    return numberArray[0][1] + '-' + numberArray[0][2]
  }
  return originalId
}

export function isFC2(serialNumber: string): boolean {
  const cuttingNumber = serialNumber.matchAll(/(FC2)(\S*)(ppv)/gi)
  const numberArray = Array.from(cuttingNumber)
  console.log('isFC2', serialNumber, numberArray)
  return numberArray.length > 0
}

function numberBegin(originalId: string) {
  const cuttingNumber = originalId.matchAll(/(^\d+)([a-z].*[a-z])(\d+)/gi)
  const numberArray = Array.from(cuttingNumber)
  console.log('numberArray', numberArray)
  if (numberArray.length === 0) return originalId

  return numberArray[0][2] + '-' + numberArray[0][3]
}

export function getSortId(originalId: string, type: number): string | undefined {
  switch (type) {
    case 0: {
      return fc2_ppv(originalId)
    }
    case 1: {
      return alphaNumber(originalId)
    }
    case 2: {
      // 123ssis123
      return numberBegin(originalId)
    }
    default:
      return undefined
  }
}

export function sortId(originalId: string): string {
  let sortId = alphaNumber(originalId)
  if (sortId !== originalId) return sortId
  sortId = numberBegin(originalId)
  if (sortId !== originalId) return sortId
  return originalId
}

export function getId() {
  return Math.random().toString(36).substring(3)
}
