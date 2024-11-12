import { ElNotification } from 'element-plus'
import { javdb_selector } from '@/site/javdb/javdb'
import { request, sortId } from '@/common'

const baseUrl = 'https://javdb.com'

async function searchHtml(serialNumber: string, retry: number = 3) {
  return request(`https://javdb.com/search?q=${serialNumber}`, 'https://javdb.com/')
    .then((res) => {
      const html = jQuery.parseHTML(res.responseText)
      const doc = jQuery(html)
      const container = doc.find(javdb_selector.container)
      if (container.length === 0) {
        throw new Error('没有找到容器')
      }
      const items = container.find(javdb_selector.item)
      if (items.length === 0) {
        ElNotification.error({
          title: 'javdb',
          message: `${serialNumber}无搜索结果`
        })
        throw new Error('没有找到项目')
      }
      return items.first()
    })
    .catch((reason) => {
      throw new Error(reason)
    })
}

async function magnetHtml(detailUrl: string, retry: number = 3): Promise<JQuery<HTMLElement>> {
  return request(baseUrl + detailUrl, 'https://javdb.com').then((res) => {
    console.log('获取磁力链接', detailUrl)
    const html = jQuery.parseHTML(res.responseText)
    const doc = jQuery(html)
    const magnetsContent = doc.find('#magnets-content')

    if (magnetsContent.length === 0) throw new Error('没有找到磁力链接容器')

    const magnets = magnetsContent.find('div.item.columns.is-desktop')
    if (magnets.length === 0) throw new Error('没有磁力链接')

    const highestScore = {
      score: 0,
      magnet: magnets.first().find('a').first()
    }

    magnets.each((index, element) => {
      let score = 0
      const magnet = jQuery(element)
      const link = magnet.find('a').first()
      const tags = link.find('div.tags span.tag').length
      score += tags
      const name = link.find('span.name').first().text()
      if (name.match(/\S+-uc/gi)) {
        score++
      }
      if (score > highestScore.score) {
        highestScore.score = score
        highestScore.magnet = link
      }
    })
    return highestScore.magnet
  })
}

export async function magnetDoc(serialNumber: string): Promise<JQuery<HTMLElement> | undefined> {
  const sortedId = sortId(serialNumber)
  return searchHtml(sortedId)
    .then(async (item): Promise<JQuery<HTMLElement> | undefined> => {
      const url = item.find('a').attr('href')
      if (!url) throw new Error('没有找到详情链接')
      try {
        return await magnetHtml(url)
      } catch (reason) {
        ElNotification.error({
          title: 'javdb',
          message: `${serialNumber}磁力链接获取失败\r${reason}`
        })
        console.error(`${serialNumber}磁力链接获取失败`, reason)
        return undefined
      }
    })
    .catch((reason) => {
      ElNotification.error({
        title: 'javdb',
        message: `${serialNumber}搜索失败\r${reason}`
      })
      console.error(`${serialNumber}搜索失败`, reason)
      return undefined
    })
}

export async function detailUrl(serialNumber: string) {
  return searchHtml(serialNumber).then((item) => {
    const url = item.find('a').attr('href')
    if (!url) throw new Error('没有找到详情链接')
    return url
  })
}

export async function magnet(serialNumber: string): Promise<string | undefined> {
  const sortedId = sortId(serialNumber)
  return magnetDoc(sortedId).then((doc) => {
    if (doc) {
      return doc.find('a').prop('href')
    }
    return undefined
  })
}
