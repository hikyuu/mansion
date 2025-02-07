import { getImgUrlFromPixhost, parseText, request } from '@/common'

export async function getDetailFromJavStore(javstore: string, retry = 3): Promise<Document | undefined> {
  try {
    const result = await request(javstore, 'https://javstore.net/')
    return parseText(result.responseText)
  } catch (reason) {
    console.error(reason)
    if (retry > 0) {
      console.log('重试获取图片')
      return getDetailFromJavStore(javstore, --retry)
    }
    return undefined
  }
}

export function getTitleFromDetail(detail: Document) {
  try {
    const array = $(detail).find('.news .first_des')
    if (array.length <= 0) return undefined
    return array.text()
  } catch (reason) {
    console.error(reason)
    return undefined
  }
}

export async function getThumbnailUrlFromDetail(detail: Document, serialNumber: string): Promise<Array<string>> {
  try {
    let img_array = $(detail).find('.news a img[alt*=".th"]')
    const urls: string[] = []
    //新方法
    if (img_array.length <= 0) {
      img_array = $(detail).find('.news > a:contains("CLICK HERE!")')
      // console.log(`新方法找到`, img_array.length)
      if (img_array.length <= 0) return urls

      for (const item of img_array) {
        const javUrl = item.getAttribute('href')
        if (!javUrl) continue
        if (javUrl.match(/(pixhost)/gi)) {
          console.log(serialNumber + ' pixhost获取的图片地址:' + javUrl)
          const pixUrl = await getImgUrlFromPixhost(javUrl)
          if (pixUrl) urls.push(pixUrl)
        }
        if (javUrl.match(/(sd)/gi) && urls.length > 0) continue
        urls.push(javUrl)
      }
      // console.log('图片列表', urls)
    } else {
      //原方法
      // @ts-ignore
      let imgUrl = img_array[img_array.length - 1].src
      imgUrl = imgUrl ? imgUrl : img_array[0].dataset.src
      if (imgUrl === undefined) return urls

      imgUrl = imgUrl
        .replace('pixhost.org', 'pixhost.to')
        .replace('.th', '')
        .replace('thumbs', 'images')
        .replace('//t', '//img')
        .replace(/[?*"]/, '')
      // console.log('javstore获取的图片地址:' + imgUrl)
      urls.push(imgUrl)
    }
    return urls.filter((url) => {
      const array = url.match(/(http:\/\/|https:\/\/)((\w|=|\?|\.|\/|&|-)+)/gi)
      if (!array || array.length <= 0) {
        return false
      }
      return true
    })
  } catch (reason) {
    console.error(reason)
    return []
  }
}
