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

export async function getPreviewUrlFromDetail(detail: Document, serialNumber: string) {
  try {
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
