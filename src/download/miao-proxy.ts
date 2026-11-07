import { ThunderApiError, ThunderTransportError } from '@hikyuu/miao'
import type {
  BinaryFetchProvider,
  BinaryFetchResult,
  PageFetchProvider,
  PageFetchResult,
  ProxyResult
} from '@/common/miao-proxy.ts'
import { CLOUDFLARE_PROBE_CHARS, detectCloudflareBlock } from '@/common/cloudflare.ts'
import { createMiaoClient } from '@/download/miao-client.ts'
import { useConfigStore } from '@/store/config-store.ts'

/**
 * miao 代理通道：把「过盾 + 发请求」整体交给 miao。
 *
 * 两条能力对应 miao 的两个动词：
 * - `web.fetch` → 页面（服务端真浏览器，Turnstile 也能过）；
 * - `web.download` → 字节（`mode: 'auto'`：先纯 HTTP，撞挑战再由服务端降级到浏览器下载栈）。
 *
 * 与旧做法（本仓库自管 FlareSolverr 会话、拿凭证自己发）的区别：脚本侧拿不到
 * 过盾 UA（`GM_xmlhttpRequest` 不能改 UA），凭证必然不匹配，所以请求必须由
 * miao 发。挑战没过时销毁 miao 侧该站点的会话，下次请求从干净状态重新过盾，
 * 因此这里不再记「最近失败过」的账去挡住重试。
 */

/**
 * 超时：SDK 默认 150s，必须大于服务端的过盾超时（默认 120s），
 * 否则会把「还在过盾」误判成失败。
 */
const PROXY_TIMEOUT_MS = 150_000

/** 种子文件上限：服务端 `torrentBase64` 解码后 ≤ 5MiB */
const MAX_TORRENT_BYTES = 5 * 1024 * 1024

/** 销毁会话的超时：一次本地 REST，不该让失败路径再等一个过盾周期 */
const SESSION_DESTROY_TIMEOUT_MS = 5_000

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/**
 * 挑战没过就销毁 miao 侧该站点的会话（`web.invalidate` = `DELETE /api/v1/web/clearance`）。
 *
 * 会话里留着的是这份没过挑战的凭证，下次请求命中缓存只会再撞一次墙；销毁后
 * 才会重新过盾。销毁失败不影响本次的失败原因，也不阻塞本次返回。
 */
export async function destroyMiaoSession(url: string): Promise<void> {
  const origin = originOf(url)
  try {
    const { baseUrl } = useConfigStore().common.miao
    await createMiaoClient(baseUrl.trim()).web.invalidate(origin, {
      timeoutMs: SESSION_DESTROY_TIMEOUT_MS
    })
    console.log('[miao] 挑战未通过，已销毁站点会话', { origin })
  } catch (error) {
    console.warn('[miao] 销毁站点会话失败', { origin, error })
  }
}

/** 哪些失败算「挑战没过」：过盾器跑过、可能留下坏会话的错误码 */
function isChallengeFailure(error: unknown): boolean {
  if (!(error instanceof ThunderApiError)) return false
  return error.isChallengeFailed || error.code === 'CHALLENGE_TIMEOUT'
}

/** 页面：交给 miao 过盾后取回 HTML */
export const miaoPageFetch: PageFetchProvider = async (url) => {
  try {
    const { baseUrl } = useConfigStore().common.miao
    const fetched = await createMiaoClient(baseUrl).web.fetch(url, {
      timeoutMs: PROXY_TIMEOUT_MS
    })
    console.log('[miao] 代取页面成功', {
      url,
      status: fetched.status,
      solved: fetched.solved,
      cached: fetched.cached,
      elapsedMs: fetched.elapsedMs,
      length: fetched.html.length
    })
    // 请求成功但拿回的仍是挑战页：这份会话没过关，销毁它给下次清场。
    // 结果原样回传，拦截判定仍由 fetchPageThroughCloudflare 统一做。
    if (
      detectCloudflareBlock({
        status: fetched.status,
        body: fetched.html.slice(0, CLOUDFLARE_PROBE_CHARS),
        finalUrl: fetched.url
      })
    ) {
      void destroyMiaoSession(url)
    }
    const result: PageFetchResult = {
      url: fetched.url,
      status: fetched.status,
      html: fetched.html,
      contentType: fetched.contentType
    }
    return { ok: true, ...result }
  } catch (error) {
    const reason = describeProxyError(error)
    console.warn('[miao] 代取页面失败', { url, reason, error })
    if (isChallengeFailure(error)) void destroyMiaoSession(url)
    return { ok: false, reason }
  }
}

/**
 * 字节：交给 miao 代下载，回 base64。
 *
 * `mode: 'auto'` 把取字节方式交给服务端：纯 HTTP 能过就用它，撞到挑战再降级到
 * 过盾器浏览器的顶层导航下载栈；`file.mode` 记下这次实际走的是哪条。
 */
export const miaoBrowserDownload: BinaryFetchProvider = async (url) => {
  try {
    const { baseUrl } = useConfigStore().common.miao
    const file = await createMiaoClient(baseUrl).web.download(url, {
      mode: 'auto',
      maxBytes: MAX_TORRENT_BYTES,
      timeoutMs: PROXY_TIMEOUT_MS
    })
    console.log('[miao] 代下载成功', {
      url,
      mode: file.mode,
      size: file.size,
      elapsedMs: file.elapsedMs
    })
    const result: BinaryFetchResult = {
      url: file.url,
      status: file.status,
      contentType: file.contentType,
      size: file.size,
      base64: file.base64
    }
    return { ok: true, ...result }
  } catch (error) {
    const reason = describeProxyError(error)
    console.warn('[miao] 代下载失败', { url, reason, error })
    if (isChallengeFailure(error)) void destroyMiaoSession(url)
    return { ok: false, reason }
  }
}

/** 通道失败 → 可展示给用户的一句话（进下载通知的「备注」行） */
export function describeProxyError(error: unknown): string {
  if (error instanceof ThunderTransportError) {
    return '无法连接 miao（未启动或未开启 REST 接口）'
  }
  if (error instanceof ThunderApiError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'miao 启用了 token 鉴权，当前集成未配置 token'
      case 'WEB_DISABLED':
        return 'miao 未启用 web 能力（apiVersion 需 ≥ 3）'
      case 'WEB_HOST_WHITELIST_EMPTY':
        return 'miao 未配置站点白名单（fail-closed）'
      case 'WEB_HOST_NOT_ALLOWED':
        return '该站点不在 miao 的站点白名单内'
      case 'WEB_URL_INVALID':
        // fake_ip 是最常见的「配置看着没错却报错」：域名被本机代理的 fake-ip 接管
        return error.reason === 'fake_ip'
          ? '目标被解析到本机代理的 fake-ip，需在 miao 里开启「信任代理 fake-ip」'
          : `目标地址不被 miao 接受（${error.reason ?? '非法'}）`
      case 'COOKIE_EXPORT_DISABLED':
        return 'miao 关闭了过盾凭证导出'
      case 'SOLVER_UNAVAILABLE':
        return '过盾器未启动或地址不可达'
      case 'SOLVER_CHROME_MISSING':
        return '过盾器所在机器没有可用 Chrome'
      case 'WEB_BUSY':
        return '过盾任务繁忙'
      case 'WEB_RESPONSE_TOO_LARGE':
        return '目标文件超过 miao 的响应体上限'
      case 'CHALLENGE_TIMEOUT':
        return '过盾超时'
      case 'CHALLENGE_FAILED':
        return '过盾失败（拿回的仍是挑战页）'
      default:
        return error.message || '调用 miao web 接口失败'
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** 日志用：把失败收成一行，不带 cookie */
export function summarizeProxyFailure(result: ProxyResult<unknown>): Record<string, unknown> {
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}
