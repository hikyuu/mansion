import { getImgUrlFromPixhost, parseText, request } from '@/common/common'
import jquery from 'jquery'

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
    const array = jquery(detail).find('.news .first_des')
    if (array.length <= 0) return undefined
    return array.text()
  } catch (reason) {
    console.error(reason)
    return undefined
  }
}

export async function getJavstoreUrl(serialNumber: string, retry = 1): Promise<string | null> {
  //异步请求搜索JavStore的番号
  return request(`https://javstore.net/search/?q=${serialNumber}`, 'https://javstore.net/')
    .then((result) => {
      const overview = parseText(result.responseText)
      // 查找包含番号的a标签数组,忽略大小写
      const a_array = jquery(overview).find(`div.grid.grid-cols-2 > a.group.block`)

      console.debug('javstore搜索结果：', a_array.length);

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

      // if (containsHTML(href)) {
      //   return Promise.resolve(null)
      // }

      return Promise.resolve('https://javstore.net' + href)
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

export async function getThumbnailUrlFromDetail(detail: Document, serialNumber: string): Promise<Array<string>> {
  try {
    let img_array = jquery(detail).find('div.p-6 a img[alt*=".th"]')
    const urls: string[] = []
    //新方法
    if (img_array.length <= 0) {

      img_array = jquery(detail).find('div.p-6 >> a:contains("CLICK HERE!")')

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
      let imgUrl = img_array[img_array.length - 1]!.dataset.src
      imgUrl = imgUrl ? imgUrl : img_array[0]!.dataset.src
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
