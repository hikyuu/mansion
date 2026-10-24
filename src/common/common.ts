import { GM_xmlhttpRequest, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import jquery from 'jquery'

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
      referrer: 'https://javstore.net/',
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
  } catch {
    alert('parse error')
    throw Error('parse error')
  }
}
