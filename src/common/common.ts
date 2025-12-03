import { GM_xmlhttpRequest, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import jquery from 'jquery'
import { ProjectError } from '@/common/errors.ts'

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
    throw Error('没匹配到番号')
  }
  return letter.toString().replace(/,/g, '-') + '-' + num
}

export const THUMBNAIL_ID = 'thumbnail'

export function getThumbnailElement(serialNumber: string, targetImgUrl: string[]) {
  // console.log('显示的图片地址:' + targetImgUrl)
  //创建img元素,加载目标图片地址
  //创建新img元素
  const $thumbnail = jquery('<div>', { id: THUMBNAIL_ID })

  for (let i = 0; i < targetImgUrl.length; i++) {
    const url = targetImgUrl[i]!

    const $img = jquery('<img>', {
      id: `IMG_${i + 1}_${serialNumber}`,
      src: url,
      retry: 0,
      alt: serialNumber,
      style: 'width:100%;'
    })
    //加载失败重试
    $img.on('error', function () {
      const $this = jquery(this)
      const retry = $this.attr('retry')
      if (retry === undefined) {
        $this.attr('retry', 1)
        $this.attr('src', url)
      } else {
        const retryInt = parseInt(retry)
        if (retryInt < 3) {
          console.log('重试加载图片', serialNumber, retryInt)
          $this.attr('retry', retryInt + 1)
          $this.attr('src', url)
        }
      }
    })
    $thumbnail.append($img)
  }
  return $thumbnail
}

export async function getJavstoreUrl(serialNumber: string, retry = 1): Promise<string | null> {
  //异步请求搜索JavStore的番号
  return request(`https://javstore.net/search/${serialNumber}.html`, 'https://javstore.net/')
    .then((result) => {
      const overview = parseText(result.responseText)
      // 查找包含番号的a标签数组,忽略大小写
      const a_array = jquery(overview).find(`.news_1n ul li h3 span a`)
      // console.log(a_array)
      let a = a_array[0]
      //如果找到全高清大图优先获取全高清的
      for (let i = 0; i < a_array.length; i++) {
        // 筛选匹配的番号数据  FC2-PPV-9999999 => 正则/FC2.*PPV.*9999999/gi
        const reg = RegExp(serialNumber.replace(/-/g, '.*'), 'gi')
        if (a_array[i]!.title.search(reg) > 0) {
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
    return jquery(response.responseText).find('#image').attr('src')
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

export function request(
  url: string,
  referer: string = '',
  timeoutInt: number = -1
): Promise<GmResponseEvent<'document'>> {
  let cookies = ''
  if (url.match(/(pixhost)/gi)) {
    if (cookies != '') cookies += '; '
    cookies += 'pixhostads=1'
  }

  return new Promise<GmResponseEvent<'document'>>((resolve, reject) => {
    // console.log(`发起网址请求：${url}`)
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      cookie: cookies,
      headers: {
        Referer: referer
      },
      timeout: timeoutInt > 0 ? timeoutInt : 30000,

      onload: (response: GmResponseEvent<'document'>) => {
        //console.log(url + " reqTime:" + (new Date() - time1));
        // console.log('请求cookie' + cookies)
        resolve(response)
      },
      onabort: () => {
        reject(new Error('请求中止'))
      },
      onerror: (reason) => {
        reject(new Error('请求出错' + reason.error))
      },
      ontimeout: () => {
        reject(new Error(`${timeoutInt > 0 ? timeoutInt : 30000}ms timeout`))
      }
    })
  })
}

export function testRequest() {
  const url = 'https://onejav.com/torrent/abf274/download/94029137/onejav.com_abf274.torrent'
  let cookie = ''
  if (url.match(/(pixhost)/gi)) {
    cookie = 'pixhostads=1'
  }
  GM_xmlhttpRequest({
    url,
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache',
      Referer: 'https://onejav.com',
      Cookie: cookie
    },
    timeout: 30000,
    onload: (response) => {
      //console.log(url + " reqTime:" + (new Date() - time1));
      console.log('response', response)
    },
    onabort: () => {
      console.error('请求中止')
    },
    onerror: (reason) => {
      console.error('error', reason)
    },
    ontimeout: () => {
      console.log('timeout')
    }
  })
}

export function parseText(text: string): Document {
  try {
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.innerHTML = text
    return doc
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    alert('parse error')
    throw Error('parse error')
  }
}

export function getSortId(originalId: string, type: number): string {
  const factory = getSeriesFactory(originalId)
  switch (factory) {
    case SeriesFactory.FC2PPV: {
      return fc2_ppv(originalId, type)
    }
    case SeriesFactory.ALLDIGIT: {
      return allDigit(originalId, type)
    }
    case SeriesFactory.NUMBERBEGIN: {
      return numberBegin(originalId, type)
    }
    case SeriesFactory.ALPHANUMBER: {
      return alphaNumber(originalId, type)
    }
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: '番号所有格式未找到' + originalId })
  }
}

function allDigit(originalId: string, type: number): string {
  const matchResult = originalId.match(/^(\d{6})(\d*)$/)
  if (!matchResult) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'allDigit番号格式错误' + originalId })
  }
  const firstSix = matchResult[1] // 前六个数字
  const theRest = matchResult[2] // 剩余的数字
  switch (type) {
    case 0:
      return firstSix + '-' + theRest
    case 1:
      return firstSix + '_' + theRest
    case 2:
      return originalId
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'allDigit番号所有格式未找到' + originalId })
  }
}

const FC2REG = /(FC2PPV)(\d+)/i
function fc2_ppv(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(FC2REG)
  if (!cuttingNumber) throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'FC2番号格式错误' + originalId })
  // console.log('cuttingNumber:', cuttingNumber)
  switch (type) {
    case 0:
      return 'Fc2-PpV-' + cuttingNumber[2]
    case 1:
      return 'fC2-pPv-' + cuttingNumber[2]
    case 2:
      const fc2 = cuttingNumber[1] + '-' + cuttingNumber[2]
      console.log('fc2:', fc2)
      return fc2
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'FC2番号所有格式未找到' + originalId })
  }
}

const ALPHANUMBERREG = /(^[a-z].*[a-z])(\d+)/i
function alphaNumber(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(ALPHANUMBERREG)
  // console.dir(numberArray)
  if (!cuttingNumber)
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号格式错误' + originalId })
  const alpha = cuttingNumber[1]
  if (!alpha) throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号格式错误' + originalId })
  switch (type) {
    case 0:
      return alpha + '-' + cuttingNumber[2]
    case 1:
      return AaBb(alpha) + '-' + cuttingNumber[2]
    case 2:
      return aAbB(alpha) + '-' + cuttingNumber[2]
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号所有格式未找到' + originalId })
  }
}

export function isFC2(serialNumber: string): boolean {
  const cuttingNumber = serialNumber.match(/(FC2)(\S*)(ppv)/i)

  return cuttingNumber !== null && cuttingNumber.length > 0
}

const NUMBERBEGINREG = /(^\d+)([a-z].*[a-z])(\d+)/i
function numberBegin(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(NUMBERBEGINREG)
  if (!cuttingNumber || cuttingNumber.length === 0) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号格式错误' + originalId })
  }
  const alpha = cuttingNumber[2]

  if (!alpha) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号格式错误' + originalId })
  }
  switch (type) {
    case 0:
      return cuttingNumber[1] + alpha + '-' + cuttingNumber[3]
    case 1:
      return cuttingNumber[1] + AaBb(alpha) + '-' + cuttingNumber[3]
    case 2:
      return cuttingNumber[1] + aAbB(alpha) + '-' + cuttingNumber[3]
    case 3:
      return AaBb(alpha) + '-' + cuttingNumber[3]
    case 4:
      return aAbB(alpha) + '-' + cuttingNumber[3]
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号所有格式未找到' + originalId })
  }
}

function AaBb(str: string) {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const s = str[i]
    if (!s) {
      continue
    }
    if (i % 2 === 0) {
      result += s.toUpperCase()
    } else {
      result += s.toLowerCase()
    }
  }
  return result
}

function aAbB(str: string) {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const s = str[i]
    if (!s) {
      continue
    }
    if (i % 2 === 0) {
      result += s.toLowerCase()
    } else {
      result += s.toUpperCase()
    }
  }
  return result
}

const ALLDIGITREG = /^\d+$/

function getSeriesFactory(originalId: string) {
  if (FC2REG.test(originalId)) {
    return SeriesFactory.FC2PPV
  }

  if (ALLDIGITREG.test(originalId)) {
    return SeriesFactory.ALLDIGIT
  }

  if (NUMBERBEGINREG.test(originalId)) {
    return SeriesFactory.NUMBERBEGIN
  }

  if (ALPHANUMBERREG.test(originalId)) {
    return SeriesFactory.ALPHANUMBER
  }
  if (ALPHANUMBERREG.test(originalId)) {
  }
  throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: '番号格式未找到' + originalId })
}

enum SeriesFactory {
  FC2PPV,
  ALPHANUMBER,
  NUMBERBEGIN,
  ALLDIGIT
}

export function sortId(originalId: string): string {
  let sortId = numberBegin(originalId, 0)
  if (sortId !== originalId) return sortId
  sortId = alphaNumber(originalId, 0)
  if (sortId !== originalId) return sortId
  return originalId
}
