import { JAVDB_NAME, javdb_detail_selector, javdb_selector } from '@/site/javdb/javdb'
import { request } from '@/common/common'
import { parseSerialNumber } from '@/common/serial-number'
import { SessionPool } from '@/common/session-pool.ts'
import { listCookies } from '@/common/flare-solverr.ts'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  detectCloudflareBlock
} from '@/common/cloudflare'
import type { CloudflareBlock } from '@/common/cloudflare'
import type { Solution } from 'flare-solverr'
import type { GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import jquery from 'jquery'

const baseUrl = 'https://javdb.com'

/** SessionPool 实例 */
const sessionPool = SessionPool.getInstance()

/** 当前是否已触发 FlareSolverr 绕过模式 */
let bypassSuccess = false

/**
 * 是否需要切 FlareSolverr：命中 CF 特征必定切；其它非 2xx 保守切，
 * 但 404/410 是「本来就没有这个页面」，切过去只会白等一次兜底。
 */
function needsFlareFallback(res: GmResponseEvent<'document'>): boolean {
  const block = detectCloudflareBlock({
    status: res.status,
    responseHeaders: res.responseHeaders,
    body: res.responseText.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: res.finalUrl
  })
  if (block) {
    console.warn('[javdb] 命中 Cloudflare 拦截', describeCloudflareBlock(block))
    return true
  }
  if (res.status === 404 || res.status === 410) return false
  return res.status >= 400
}

/**
 * FlareSolverr 也可能把挑战页原样拿回来（Turnstile 没过、IP 被限流）。
 * 不校验就会把挑战页当成正常页面，最后报成「没有找到磁力链接容器」，把真正原因藏起来。
 */
function detectFlareBlock(solution: Solution): CloudflareBlock | null {
  return detectCloudflareBlock({
    status: solution.status,
    body: solution.response?.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: solution.url
  })
}

/**
 * 取页面 DOM：先走 GM 请求，命中 Cloudflare 后切 FlareSolverr（此后本会话内一律走 FlareSolverr）。
 * 搜索页与详情页共用同一出口，避免每个调用点各写一遍判定与重试。
 *
 * 兜底拿到挑战页时轮换一次会话再取 —— 会话里的 Chrome 沾上挑战态后，只有换新实例才解得开。
 */
async function fetchPageDoc(url: string): Promise<JQuery<HTMLElement>> {
  if (!bypassSuccess) {
    const res = await request(url, 'https://javdb.com/')
    if (!needsFlareFallback(res)) return jquery(res.responseText)
    console.log('检测到 Cloudflare 拦截，切换为 FlareSolverr 绕过模式', url)
    bypassSuccess = true
  }

  let solution = await flareGet(url)
  let block = detectFlareBlock(solution)
  if (block) {
    console.warn('[javdb] FlareSolverr 拿回的仍是拦截页，轮换会话后重试', describeCloudflareBlock(block))
    await sessionPool.rotate(JAVDB_NAME)
    solution = await flareGet(url)
    block = detectFlareBlock(solution)
    if (block) throw new CloudflareBlockedError('javdb', block, 'FlareSolverr 未能绕过')
  }
  return jquery(solution.response!)
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

/**
 * 磁力条目打分：名字里的 -c（中文字幕）+1、-uc（无码）+2，沿用老口径。
 * 新版详情页把这些标记搬到了 `div.tags`，所以分数之外还数标签个数，作为同分时的次序。
 */
function scoreOfName(name: string): number {
  let score = 0
  if (name.match(/\S+[-|_]c/gi)) score++
  if (name.match(/\S+[-|_]uc/gi)) score += 2
  return score
}

/** 候选之间的先后：分高者优先，其次标签多者；两者都相同则保持页面顺序（先出现的留下） */
function isBetterCandidate(candidate: MagnetCandidate, current: MagnetCandidate): boolean {
  if (candidate.score !== current.score) return candidate.score > current.score
  return candidate.tagCount > current.tagCount
}

/**
 * 挑磁力：高分链接 → 标签最多 → 页面顺序第一个。
 * 三级依次降级：整页名字里都没有 -c / -uc 时退到标签最多的一条，标签也一样多就取页面上的第一条。
 * 「要不要接受非高分结果」留给调用方（onejav 的第一级只认分数 > 0 的那条）。
 */
export function pickMagnet(doc: JQuery): Promise<MagnetCandidate> {
  const magnetsContent = doc.find(javdb_detail_selector.magnetsContainer)
  if (magnetsContent.length === 0) {
    // 骨架在、磁链区块不在 = 该作品确实没有磁力；连骨架都没有 = 拿到的不是详情页
    if (doc.find(javdb_detail_selector.detailSkeleton).length === 0) {
      console.warn('[javdb] 拿到的页面没有详情页骨架，可能是拦截页或登录墙', {
        htmlLength: doc.html()?.length ?? 0
      })
      return Promise.reject('javdb 详情页没拿到（缺少详情页骨架，可能是拦截页或需要登录）')
    }
    return Promise.reject('javdb 详情页没有磁力区块（该作品暂无磁链）')
  }

  // 容器内还混有广告（div.sda-content）与排序控件（div.magnet-sort），只保留带 magnet: 链接的条目
  const items = magnetsContent.find(javdb_detail_selector.magnetItem)
  const magnets = items.filter(
    (_, element) => jquery(element).find(javdb_detail_selector.magnetLink).length > 0
  )
  if (magnets.length === 0) {
    // 条目数写进原因：改版时能一眼看出是「条目没匹配上」还是「条目里没有磁链」
    console.warn('[javdb] 磁力容器里没有可用条目', { itemCount: items.length })
    return Promise.reject(`没有找到磁力链接（容器内 ${items.length} 个条目均无 magnet: 链接）`)
  }

  const candidates = magnets.toArray().map((element): MagnetCandidate => {
    const item = jquery(element)
    const link = item.find(javdb_detail_selector.magnetLink).first()
    const name = link.find(javdb_detail_selector.magnetName).first().text()
    return {
      score: scoreOfName(name),
      tagCount: item.find(javdb_detail_selector.magnetTags).length,
      magnet: link
    }
  })

  const best = candidates.reduce((current, candidate) =>
    isBetterCandidate(candidate, current) ? candidate : current
  )
  console.log('[javdb] 选中磁力', {
    name: best.magnet.find(javdb_detail_selector.magnetName).first().text(),
    score: best.score,
    tagCount: best.tagCount,
    candidates: candidates.length
  })
  return Promise.resolve(best)
}

/**
 * 通过 SessionPool 使用 FlareSolverr 获取页面 HTML
 * - 自动管理 session 创建/复用/轮换
 * - 500 错误自动重建 session 并重试
 */
async function flareGet(fullUrl: string): Promise<Solution> {
  const siteCookies = await listCookies('javdb.com')
  const { solution } = await sessionPool.request(JAVDB_NAME, fullUrl, siteCookies)
  if (!solution.response) {
    throw new Error('FlareSolverr 未返回有效响应')
  }
  return solution
}

/**
 * 详情链接归一化：列表页给的可能是绝对地址（`https://javdb.com/v/G7MJ`），
 * 搜索页与页内链接给的是相对路径（`/v/G7MJ`）。
 * 直接 `baseUrl + href` 在绝对地址上会拼成 `https://javdb.comhttps://javdb.com/v/G7MJ`，
 * GM 请求当场报错 —— 这是「解析下载地址失败」最常见的来源。
 */
export function absoluteDetailUrl(href: string): string {
  const trimmed = href.trim()
  try {
    return new URL(trimmed, `${baseUrl}/`).toString()
  } catch {
    throw new Error(`javdb 详情链接无法解析: ${href}`)
  }
}

async function magnetHtml(detailUrl: string): Promise<MagnetCandidate> {
  const doc = await fetchPageDoc(absoluteDetailUrl(detailUrl))
  return pickMagnet(doc)
}

declare interface MagnetCandidate {
  score: number
  tagCount: number
  magnet: JQuery
}

/** javdb 详情页的解析结果：挑出的那条磁力 + 它的分数（> 0 才算「高分」） */
export interface JavdbMagnetChoice {
  magnet: JQuery<HTMLElement>
  score: number
}

/**
 * 一次解析拿全：搜索 → 详情页 → 挑磁力（分数一并带出）。
 *
 * 调用方按 score 自己决定要不要当高分用 —— 这样「高分未命中、之后又需要任意磁力」的场景
 * 不必再完整请求一遍 javdb（搜索页 + 详情页各一次，还可能触发 FlareSolverr）。
 */
export async function pickJavdbMagnet(serialNumber: string): Promise<JavdbMagnetChoice> {
  const sortedId = parseSerialNumber(serialNumber).javdbVariant()
  const item = await searchHtml(sortedId)
  const url = item.find('a').attr('href')
  if (!url) throw new Error('没有找到详情链接')
  const best = await magnetHtml(url)
  return { magnet: best.magnet as JQuery<HTMLElement>, score: best.score }
}

export async function downloadFromJavdb(serialNumber: string): Promise<JQuery | undefined> {
  console.log('下载 JavDB 磁力链接', serialNumber)
  const best = await pickJavdbMagnet(serialNumber)
  return best.magnet
}

export async function downloadFromLocal(url: string) {
  return magnetHtml(url).then((best) => {
    return best.magnet
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
