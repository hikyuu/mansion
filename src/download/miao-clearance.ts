import { ThunderApiError, ThunderTransportError } from '@hikyuu/miao'
import type { ClearanceProvider, ClearanceResult } from '@/common/clearance.ts'
import { originOf } from '@/common/clearance.ts'
import { createMiaoClient } from '@/download/miao-client.ts'
import { destroyMiaoSession } from '@/download/miao-proxy.ts'
import { useConfigStore } from '@/store/config-store.ts'

/**
 * miao 过盾通道：把「过 Cloudflare」这件事交给 miao 的 web 能力
 * （`POST /api/v1/web/clearance`，由 `@hikyuu/miao` 的 `MiaoClient.web` 提供）。
 *
 * 与旧做法（本仓库自己连 127.0.0.1:8191 管 FlareSolverr 会话）的区别：
 * 过盾器的安装、启停、版本与站点白名单都在 miao 里管，这里只拿凭证 —— 拿回来是
 * `cookie` + `userAgent` 一对，本轮请求原样带上即可，不再需要会话池与轮换。
 */

/**
 * 过盾超时：SDK 默认 150s，必须大于服务端的过盾超时（默认 120s），
 * 否则会把「还在过盾」误判成失败。
 */
const CLEARANCE_TIMEOUT_MS = 150_000

/**
 * 取一条 URL 的过盾凭证；任何失败都折成 `{ ok: false, reason }`，绝不抛错。
 *
 * 站点白名单在 miao 侧（fail-closed），本地不再按站点配坐标：
 * 没配白名单的站点会被服务端直接拒掉，代价只是一次 REST 往返。
 */
export const miaoClearance: ClearanceProvider = async (url) => {
  const { baseUrl } = useConfigStore().common.miao
  const trimmed = baseUrl.trim()
  const origin = originOf(url)

  try {
    const clearance = await createMiaoClient(trimmed).web.clearance(origin, {
      timeoutMs: CLEARANCE_TIMEOUT_MS
    })
    if (!clearance.cookieHeader) {
      // 服务端可能关掉了凭证导出（COOKIE_EXPORT_DISABLED 会报错，这里兜「回了空串」）
      return { ok: false, reason: 'miao 没有回传可用的过盾凭证' }
    }
    // 只记结论，不记 cookie 值：凭证等价于登录态
    console.log('[miao] 过盾成功', {
      origin,
      cached: clearance.cached,
      solved: clearance.solved,
      elapsedMs: clearance.elapsedMs,
      cookieCount: clearance.cookies.length,
      expiresAt: clearance.expiresAt
    })
    return {
      ok: true,
      ticket: { cookie: clearance.cookieHeader, userAgent: clearance.userAgent }
    }
  } catch (error) {
    const reason = describeClearanceError(error)
    console.warn('[miao] 过盾失败', { origin, reason, error })
    if (
      error instanceof ThunderApiError &&
      (error.isChallengeFailed || error.code === 'CHALLENGE_TIMEOUT')
    ) {
      void destroyMiaoSession(url)
    }
    return { ok: false, reason }
  }
}

/** 过盾失败 → 可展示给用户的一句话（进下载通知的「备注」行） */
export function describeClearanceError(error: unknown): string {
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
      case 'CHALLENGE_TIMEOUT':
        return '过盾超时'
      case 'CHALLENGE_FAILED':
        return '过盾失败（拿回的仍是挑战页）'
      default:
        return error.message || '调用 miao 过盾接口失败'
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** 日志用：把结果收成一行，不把 cookie 带进去 */
export function summarizeClearance(result: ClearanceResult): Record<string, unknown> {
  return result.ok ? { ok: true, userAgent: result.ticket.userAgent } : { ok: false, reason: result.reason }
}
