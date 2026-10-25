import jquery from 'jquery'
import { fetchPageThroughCloudflare, type CloudflarePage } from '@/common/cloudflare-guard'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'

const baseUrl = 'https://onejav.com'

/** 站点标识：FlareSolverr 会话池分桶与 bypass 标记的键 */
const ONEJAV_SITE = 'onejav'
const ONEJAV_DOMAIN = 'onejav.com'

/** 声明成种子/二进制的 content-type */
const FILE_CONTENT_TYPES = ['application/x-bittorrent', 'application/octet-stream']

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
 * Cloudflare 拦截的识别与兜底在 fetchPageThroughCloudflare 里完成：挑战页的最终 URL 与原 URL
 * 相同、状态码也可能是 200，只有先把拦截认出来，才不会把它误判成「直链」或「没有种子」。
 * 兜底仍失败时抛 CloudflareBlockedError，文案直接进下载通知的备注。
 */
export async function resolveOnejavTorrent(detailUrl: string): Promise<string | null> {
  const fullUrl = baseUrl + detailUrl
  const page = await fetchPageThroughCloudflare({
    site: ONEJAV_SITE,
    siteLabel: 'onejav',
    url: fullUrl,
    referer: `${baseUrl}/`,
    cookieDomain: ONEJAV_DOMAIN
  })

  if (looksLikeTorrentFile(page)) return page.url
  if (page.url.includes('file.onejav.com')) return page.url

  const href = jquery(page.html).find(ONEJAV_DOWNLOAD).first().attr('href')
  if (!href) return null
  return baseUrl + href
}
