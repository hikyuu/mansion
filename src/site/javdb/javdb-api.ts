import { javdb_selector } from '@/site/javdb/javdb'
import { request, sortId } from '@/common'

const baseUrl = 'https://javdb.com'

async function searchHtml(serialNumber: string, retry: number = 3) {
  return request(`https://javdb.com/search?q=${serialNumber}`, 'https://javdb.com/').then((res) => {
    const html = jQuery.parseHTML(res.responseText)
    const doc = jQuery(html)
    const container = doc.find(javdb_selector.container)
    if (container.length === 0) {
      if (doc.text().includes(`The owner of this website has banned your access based on your browser's behaving`)) {
        return Promise.reject('IP被ban了')
      } else {
        return Promise.reject('没有找到容器')
      }
    }
    const items = container.find(javdb_selector.item)
    if (items.length === 0) {
      return Promise.reject('没有搜索结果')
    }
    return items.first()
  })
}

async function magnetHtml(detailUrl: string, retry: number = 3): Promise<HighestScore> {
  return request(baseUrl + detailUrl, baseUrl).then((res) => {
    console.log('获取磁力链接', detailUrl)
    const html = jQuery.parseHTML(res.responseText)
    const doc = jQuery(html)
    const magnetsContent = doc.find('#magnets-content')

    if (magnetsContent.length === 0) {
      return Promise.reject('没有找到磁力链接容器')
    }

    const magnets = magnetsContent.find('div.item.columns.is-desktop')
    if (magnets.length === 0) {
      return Promise.reject('没有找到磁力链接')
    }

    const highestScore = {
      score: 0,
      magnet: magnets.first().find('a').first()
    }

    magnets.each((index, element) => {
      let score = 0
      const magnet = jQuery(element)
      const link = magnet.find('a').first()
      const name = link.find('span.name').first().text()
      if (name.match(/\S+[-|_]c/gi)) {
        score++
      }
      if (name.match(/\S+[-|_]uc/gi)) {
        score += 2
      }
      if (score > highestScore.score) {
        highestScore.score = score
        highestScore.magnet = link
      }
    })

    return highestScore
  })
}

declare interface HighestScore {
  score: number
  magnet: JQuery<HTMLElement>
}

export async function highScoreMagnet(serialNumber: string): Promise<JQuery<HTMLElement> | undefined> {
  const sortedId = sortId(serialNumber)
  return searchHtml(sortedId).then(async (item): Promise<JQuery<HTMLElement> | undefined> => {
    const url = item.find('a').attr('href')
    if (!url) throw new Error('没有找到详情链接')
    return magnetHtml(url).then((highestScore) => {
      if (highestScore.score === 0) {
        return Promise.reject('没有找到高分磁力链接')
      }
      return highestScore.magnet
    })
  })
}

export async function downloadFromLocal(url: string) {
  return magnetHtml(url).then((highestScore) => {
    return highestScore.magnet
  })
}

export function getDetailHref(item: JQuery<HTMLElement>) {
  return item.find('a').attr('href')
}

export async function detailUrl(serialNumber: string) {
  return searchHtml(serialNumber).then((item) => {
    const url = getDetailHref(item)
    if (!url) throw new Error('没有找到详情链接')
    return url
  })
}

export async function magnet(serialNumber: string): Promise<string | undefined> {
  const sortedId = sortId(serialNumber)
  return highScoreMagnet(sortedId).then((doc) => {
    if (doc) {
      return doc.find('a').prop('href')
    }
    return undefined
  })
}
