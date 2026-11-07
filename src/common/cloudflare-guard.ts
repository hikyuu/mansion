import { request } from '@/common/common'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  describeProxyFailure,
  detectCloudflareBlock,
  parseResponseHeaders,
  type CloudflareBlock
} from '@/common/cloudflare'
import { tryProxy, type PageFetchProvider } from '@/common/miao-proxy.ts'

export interface CloudflarePageInput {
  /** 站点标识，只用于日志定位，如 'onejav' */
  site: string
  /** 错误文案里展示的站点名，缺省用 cookieDomain */
  siteLabel?: string
  url: string
  referer?: string
  /** 拼默认 Referer 用的域名，如 'onejav.com' */
  cookieDomain: string
  /**
   * 页面取回通道（miao 的 `web.fetch`）。
   * 给了才在命中拦截后交给它重取；不给 = 命中即抛错。
   */
  pageFetch?: PageFetchProvider
}

export interface CloudflarePage {
  url: string
  status: number
  html: string
  /** 响应头（小写键）：调用方靠 content-type 判断「是页面还是文件」 */
  headers: Record<string, string>
}

/**
 * 取页面 HTML：GM 直取 → 识别拦截 → （可选）交给 miao 代取 → 仍失败即抛。
 *
 * 判定必须先于业务解析：挑战页的最终 URL 与原 URL 相同、状态码也可能是 200，
 * 交给业务层只会得出「没有可下载种子」这种误导性结论。
 *
 * 拦截后**不自己重取**：`GM_xmlhttpRequest` 不能改 UA，而 miao 的过盾凭证绑定
 * 它自己的 UA，自己带着 cookie 发只会再吃一次挑战。所以整页交给 miao 取。
 */
export async function fetchPageThroughCloudflare(input: CloudflarePageInput): Promise<CloudflarePage> {
  const label = input.siteLabel ?? input.cookieDomain
  const referer = input.referer ?? `https://${input.cookieDomain}/`

  const page = await loadPage(input.url, referer)
  if (!page.block) return page.page

  console.warn('[cloudflare] 命中拦截', {
    site: input.site,
    url: input.url,
    ...describeCloudflareBlock(page.block)
  })

  const proxied = await tryProxy(input.pageFetch, input.url)
  if (proxied?.ok !== true) {
    throw new CloudflareBlockedError(
      label,
      page.block,
      describeProxyFailure({
        attempted: input.pageFetch !== undefined,
        ...(proxied ? { reason: proxied.reason } : {})
      })
    )
  }

  // 代取回来的页面仍要复核：服务端也可能被拒（过盾过期、站点策略变化）
  const recheck = detectCloudflareBlock({
    status: proxied.status,
    body: proxied.html.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: proxied.url
  })
  if (recheck) {
    console.warn('[cloudflare] miao 代取后仍是拦截页', {
      site: input.site,
      url: input.url,
      ...describeCloudflareBlock(recheck)
    })
    throw new CloudflareBlockedError(label, recheck, 'miao 代取后仍被拦截')
  }

  console.log('[cloudflare] miao 代取成功', {
    site: input.site,
    url: input.url,
    status: proxied.status,
    length: proxied.html.length
  })

  return {
    url: proxied.url,
    status: proxied.status,
    html: proxied.html,
    headers: proxied.contentType ? { 'content-type': proxied.contentType } : {}
  }
}

/** 取一次页面并判定拦截（GM 请求，浏览器栈 + 浏览器自身 cookie） */
async function loadPage(
  url: string,
  referer: string
): Promise<{ page: CloudflarePage; block: CloudflareBlock | null }> {
  const res = await request(url, referer)

  const block = detectCloudflareBlock({
    status: res.status,
    responseHeaders: res.responseHeaders,
    body: res.responseText.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: res.finalUrl
  })

  return {
    block,
    page: {
      url: res.finalUrl || url,
      status: res.status,
      html: res.responseText,
      headers: Object.fromEntries(parseResponseHeaders(res.responseHeaders))
    }
  }
}
