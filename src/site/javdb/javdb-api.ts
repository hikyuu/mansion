import { JAVDB_NAME, javdb_selector } from '@/site/javdb/javdb'
import { request, sortId } from '@/common/common'
import { createSession, getFromFlareSolverr, type GmCallbackCookie } from '@/common/flare-solverr.ts'
import { GM_cookie, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import jquery from 'jquery'
import { useConfigStore } from '@/store/config-store.ts'

const baseUrl = 'https://javdb.com'

let bypassSuccess = false

function handleSearch(doc: JQuery<HTMLElement>) {
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
}

async function searchHtml(serialNumber: string, retry: number = 3) {
  const fullUrl = `https://javdb.com/search?q=${serialNumber}`
  if (bypassSuccess) {
    console.log('请求搜索页（已绕过Cloudflare）', fullUrl)
    const response = await flareGet(fullUrl)
    const flareDoc = jquery(response)
    // 使用类型守卫过滤出 HTMLElement
    return handleSearch(flareDoc)
  }
  const res = await request(`fullUrl`, 'https://javdb.com/')
  const doc = jQuery(res.responseText)
  if (res.status !== 200 || doc.text().includes('Just a moment...')) {
    console.log('被Cloudflare拦截')
    if (!bypassSuccess) {
      bypassSuccess = true
      return searchHtml(serialNumber, retry)
    }
  }
  return handleSearch(doc)
}

function handleMagnet(doc: JQuery) {
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
}

async function flareGet(fullUrl: string): Promise<string> {
  const siteCookies = await getCookies()
  const sessionId = await getSessionId()
  const solution = await getFromFlareSolverr(fullUrl, sessionId, siteCookies)
  if (!solution.response) {
    throw new Error('FlareSolverr 未返回有效响应')
  }
  return solution.response
}

async function magnetHtml(detailUrl: string, retry: number = 2): Promise<HighestScore> {
  if (retry === 0) {
    throw new Error('多次重试仍无法获取磁力链接，可能是网站结构变化或IP被封，请检查。')
  }
  const fullUrl = baseUrl + detailUrl
  if (bypassSuccess) {
    console.log('请求详情页(绕过Cloudflare）', fullUrl)
    const response = await flareGet(fullUrl)
    const flareDoc = jquery(response)
    // 使用类型守卫过滤出 HTMLElement
    return handleMagnet(flareDoc)
  }
  console.log('请求详情页', fullUrl)
  const res: GmResponseEvent<'document'> = await request(fullUrl, 'https://javdb.com/', -1)
  const doc = jquery(res.responseText)
  if (res.status !== 200 || doc.text().includes('Just a moment...')) {
    console.log('被Cloudflare拦截')
    if (!bypassSuccess) {
      console.log('使用 FlareSolverr 绕过 Cloudflare')
      bypassSuccess = true
      return magnetHtml(detailUrl, retry - 1)
    }
  }
  return handleMagnet(doc)
}

async function getSessionId() {
  const session = useConfigStore().common.sessionId.find((s) => s.site == JAVDB_NAME)
  if (!session) {
    console.log('Javdb 获取新的 FlareSolverr 会话 ID')
    const sessionId = await createSession()
    useConfigStore().updateSessionId(JAVDB_NAME, sessionId)
    return sessionId
  }
  return session.id
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
function getCookies(): Promise<GmCallbackCookie[]> {
  return new Promise((resolve, reject) => {
    GM_cookie.list({ domain: 'javdb.com' }, (cookies) => {
      if (cookies) resolve(cookies)
      else reject('Failed to get cookies')
    })
  })
}
