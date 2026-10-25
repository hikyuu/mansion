import { request } from '@/common/common'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  detectCloudflareBlock,
  parseResponseHeaders
} from '@/common/cloudflare'

export interface CloudflarePageInput {
  /** 站点标识，只用于日志定位，如 'onejav' */
  site: string
  /** 错误文案里展示的站点名，缺省用 cookieDomain */
  siteLabel?: string
  url: string
  referer?: string
  /** 拼默认 Referer 用的域名，如 'onejav.com' */
  cookieDomain: string
}

export interface CloudflarePage {
  url: string
  status: number
  html: string
  /** 响应头（小写键）：调用方靠 content-type 判断「是页面还是文件」 */
  headers: Record<string, string>
}

/**
 * 取页面 HTML：GM 直取 → 识别拦截 → 命中即抛 CloudflareBlockedError。
 *
 * 判定必须先于业务解析：挑战页的最终 URL 与原 URL 相同、状态码也可能是 200，
 * 交给业务层只会得出「没有可下载种子」这种误导性结论。
 *
 * 这里刻意不做自动兜底：实测 onejav 的 Turnstile 只有顶层导航能过，
 * FlareSolverr 用无头浏览器 60s 也过不了，兜底只会让用户白等一分钟。
 * 由站点层决定命中拦截后的去向（onejav 是交给浏览器）。
 */
export async function fetchPageThroughCloudflare(input: CloudflarePageInput): Promise<CloudflarePage> {
  const label = input.siteLabel ?? input.cookieDomain
  const referer = input.referer ?? `https://${input.cookieDomain}/`
  const res = await request(input.url, referer)

  const block = detectCloudflareBlock({
    status: res.status,
    responseHeaders: res.responseHeaders,
    body: res.responseText.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: res.finalUrl
  })
  if (block) {
    console.warn('[cloudflare] 命中拦截', {
      site: input.site,
      url: input.url,
      ...describeCloudflareBlock(block)
    })
    throw new CloudflareBlockedError(label, block, '脚本请求无法通过该站点验证，已改为交给浏览器')
  }

  return {
    url: res.finalUrl || input.url,
    status: res.status,
    html: res.responseText,
    headers: Object.fromEntries(parseResponseHeaders(res.responseHeaders))
  }
}
