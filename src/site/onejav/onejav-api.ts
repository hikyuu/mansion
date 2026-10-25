import jquery from 'jquery'
import { CloudflareBlockedError } from '@/common/cloudflare'
import { fetchPageThroughCloudflare, type CloudflarePage } from '@/common/cloudflare-guard'
import { handoffToBrowser } from '@/download/browser'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'

const baseUrl = 'https://onejav.com'

/** 站点标识：日志定位用 */
const ONEJAV_SITE = 'onejav'
const ONEJAV_DOMAIN = 'onejav.com'

/** 声明成种子/二进制的 content-type */
const FILE_CONTENT_TYPES = ['application/x-bittorrent', 'application/octet-stream']

/** 详情页里的下载按钮是相对路径，绝对化后才能交给浏览器或下载通道 */
export function absoluteSeedUrl(href: string): string {
  return /^https?:\/\//i.test(href) ? href : baseUrl + href
}

/**
 * 响应是不是种子文件本体。
 * 不指定 responseType 时 GM 会把二进制当文本解码，所以 content-type 缺失时用首字符兜底：
 * 页面一定是 HTML（以 '<' 开头），文件不会。
 */
function looksLikeTorrentFile(page: CloudflarePage): boolean {
  const contentType = (page.headers['content-type'] ?? '').toLowerCase()
  if (FILE_CONTENT_TYPES.some((type) => contentType.includes(type))) return true
  const head = page.html.trimStart()
  return head.length > 0 && !head.startsWith('<')
}

/**
 * 解析 onejav 详情页的最终下载地址，不做提交（提交由下载意图模块统一负责）。
 * 三种结局：详情页本身就是直链 / 重定向到 file.onejav.com / 页面内 a[title='Download .torrent']。
 *
 * Cloudflare 拦截的识别在 fetchPageThroughCloudflare 里完成：挑战页的最终 URL 与原 URL
 * 相同、状态码也可能是 200，只有先把拦截认出来，才不会误判成「直链」或「没有种子」。
 * 命中即抛 CloudflareBlockedError —— 不在这里兜底，去向由调用方决定。
 */
export async function resolveOnejavTorrent(detailUrl: string): Promise<string | null> {
  const page = await fetchPageThroughCloudflare({
    site: ONEJAV_SITE,
    siteLabel: ONEJAV_SITE,
    url: absoluteSeedUrl(detailUrl),
    referer: `${baseUrl}/`,
    cookieDomain: ONEJAV_DOMAIN
  })

  if (looksLikeTorrentFile(page)) return page.url
  if (page.url.includes('file.onejav.com')) return page.url

  const href = jquery(page.html).find(ONEJAV_DOWNLOAD).first().attr('href')
  if (!href) return null
  return absoluteSeedUrl(href)
}

export interface OnejavSeed {
  url: string
  /** 'browser' = 已被 Cloudflare 拦下，地址已交给浏览器自己过验证并下载 */
  handoff?: 'browser'
}

/**
 * 种子地址的最终出口：直取能解析就返回地址；被 Cloudflare 拦下就把下载按钮的地址
 * 交给浏览器（Turnstile 只认顶层导航，脚本侧无论怎么请求都是 403）。
 * 解析不到返回 null，其余异常原样抛出。
 */
export async function resolveOnejavSeed(detailHref: string): Promise<OnejavSeed | null> {
  const seedUrl = absoluteSeedUrl(detailHref)
  try {
    const url = await resolveOnejavTorrent(detailHref)
    return url ? { url } : null
  } catch (error) {
    if (!(error instanceof CloudflareBlockedError)) throw error
    console.warn('[onejav] 种子链接被 Cloudflare 拦截，交给浏览器下载', seedUrl)
    handoffToBrowser(seedUrl)
    return { url: seedUrl, handoff: 'browser' }
  }
}
