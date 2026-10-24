import { JAVDB_NAME, javdb_detail_selector, javdb_selector } from '@/site/javdb/javdb'
import { request } from '@/common/common'
import { parseSerialNumber } from '@/common/serial-number'
import { SessionPool } from '@/common/session-pool.ts'
import type { GmCallbackCookie } from '@/common/flare-solverr.ts'
import { GM_cookie, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import jquery from 'jquery'

const baseUrl = 'https://javdb.com'

/** SessionPool 实例 */
const sessionPool = SessionPool.getInstance()

/** 当前是否已触发 FlareSolverr 绕过模式 */
let bypassSuccess = false

/** Cloudflare 拦截判据：HTTP 状态码非 200 或返回挑战页 */
function isCloudflareBlocked(res: GmResponseEvent<'document'>, doc: JQuery<HTMLElement>): boolean {
  return res.status !== 200 || doc.text().includes('Just a moment...')
}

/**
 * 取页面 DOM：先走 GM 请求，命中 Cloudflare 后切 FlareSolverr（此后本会话内一律走 FlareSolverr）。
 * 搜索页与详情页共用同一出口，避免每个调用点各写一遍判定与重试。
 */
async function fetchPageDoc(url: string): Promise<JQuery<HTMLElement>> {
  if (!bypassSuccess) {
    const res = await request(url, 'https://javdb.com/')
    const doc = jquery(res.responseText)
    if (!isCloudflareBlocked(res, doc)) return doc
    console.log('检测到 Cloudflare 拦截，切换为 FlareSolverr 绕过模式', url)
    bypassSuccess = true
  }
  return jquery(await flareGet(url))
}

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

async function searchHtml(serialNumber: string) {
  const doc = await fetchPageDoc(`https://javdb.com/search?q=${serialNumber}`)
  return handleSearch(doc)
}

function handleMagnet(doc: JQuery) {
  const magnetsContent = doc.find(javdb_detail_selector.magnetsContainer)
  if (magnetsContent.length === 0) {
    return Promise.reject('没有找到磁力链接容器')
  }

  // 容器内还混有广告（div.sda-content），只保留包含 magnet: 链接的条目
  const magnets = magnetsContent
    .find(javdb_detail_selector.magnetItem)
    .filter((_, element) => jquery(element).find(javdb_detail_selector.magnetLink).length > 0)
  if (magnets.length === 0) {
    return Promise.reject('没有找到磁力链接')
  }

  const highestScore: HighestScore = {
    score: 0,
    magnet: magnets.first().find(javdb_detail_selector.magnetLink).first()
  }

  magnets.each((index, element) => {
    let score = 0
    const link = jquery(element).find(javdb_detail_selector.magnetLink).first()
    const name = link.find(javdb_detail_selector.magnetName).first().text()
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

/**
 * 通过 SessionPool 使用 FlareSolverr 获取页面 HTML
 * - 自动管理 session 创建/复用/轮换
 * - 500 错误自动重建 session 并重试
 */
async function flareGet(fullUrl: string): Promise<string> {
  const siteCookies = await getCookies()
  const { solution } = await sessionPool.request(JAVDB_NAME, fullUrl, siteCookies)
  if (!solution.response) {
    throw new Error('FlareSolverr 未返回有效响应')
  }
  return solution.response
}

async function magnetHtml(detailUrl: string): Promise<HighestScore> {
  const doc = await fetchPageDoc(baseUrl + detailUrl)
  return handleMagnet(doc)
}

declare interface HighestScore {
  score: number
  magnet: JQuery
}

export async function highScoreMagnet(serialNumber: string): Promise<JQuery<HTMLElement> | undefined> {
  const sortedId = parseSerialNumber(serialNumber).javdbVariant()
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

export async function downloadFromJavdb(serialNumber: string): Promise<JQuery | undefined> {
  const sortedId = parseSerialNumber(serialNumber).javdbVariant()
  console.log('下载 JavDB 磁力链接', sortedId)
  return searchHtml(sortedId).then(async (item): Promise<JQuery | undefined> => {
    const url = item.find('a').attr('href')
    if (!url) throw new Error('没有找到详情链接')
    return magnetHtml(url).then((highestScore) => {
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
