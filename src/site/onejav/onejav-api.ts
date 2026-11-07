import jquery from 'jquery'
import { fetchPageThroughCloudflare, type CloudflarePage } from '@/common/cloudflare-guard'
import { miaoPageFetch } from '@/download/miao-proxy.ts'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'

const baseUrl = 'https://onejav.com'

/** 站点标识：日志定位用 */
const ONEJAV_SITE = 'onejav'
const ONEJAV_DOMAIN = 'onejav.com'

/** 声明成种子/二进制的 content-type */
const FILE_CONTENT_TYPES = ['application/x-bittorrent', 'application/octet-stream']

/** 详情页里的下载按钮是相对路径，绝对化后才能交给下载通道 */
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
 * 三种结局：`downloadHref` 本身就是直链 / 重定向到 file.onejav.com / 页面内 a[title='Download .torrent']。
 *
 * 直链（`.torrent` / `.zip` / `file.*` 子域）直接返回，不再当页面探测：对它发 GM 请求
 * 必被 Turnstile 拦下，探测只会白付一次 `web.fetch` 的过盾成本 —— 字节本就由下载
 * 通道（`web.download`）负责。
 *
 * Cloudflare 拦截的识别在 fetchPageThroughCloudflare 里完成：挑战页的最终 URL 与原 URL
 * 相同、状态码也可能是 200，只有先把拦截认出来，才不会误判成「直链」或「没有种子」。
 * 命中即抛 CloudflareBlockedError —— 不在这一层兜底，去向由调用方（onejav 的下载链条）决定。
 */
export async function resolveOnejavTorrent(detailUrl: string): Promise<string | null> {
  const url = absoluteSeedUrl(detailUrl)
  const { hostname, pathname } = new URL(url)
  if (hostname === 'file.onejav.com' || /\.torrent$/i.test(pathname) || /\.zip$/i.test(pathname)) {
    return url
  }

  const page = await fetchPageThroughCloudflare({
    site: ONEJAV_SITE,
    siteLabel: ONEJAV_SITE,
    url,
    referer: `${baseUrl}/`,
    cookieDomain: ONEJAV_DOMAIN,
    // 被 CF 拦时交给 miao 代取页面：脚本侧改不了 UA，自己带凭证重取必然再吃挑战
    pageFetch: miaoPageFetch
  })

  if (looksLikeTorrentFile(page)) return page.url
  if (page.url.includes('file.onejav.com')) return page.url

  const href = jquery(page.html).find(ONEJAV_DOWNLOAD).first().attr('href')
  if (!href) return null
  return absoluteSeedUrl(href)
}
