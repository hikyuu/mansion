import { MiaoClient } from '@hikyuu/miao'
import { gmFetch } from '@/download/gm-fetch.ts'

/**
 * 按配置里的 `baseUrl` 建 miao 客户端。
 *
 * `@hikyuu/miao` 的 `MiaoClient` 是「完整版」入口（继承 `ThunderClient`，再挂 web 能力），
 * 迅雷任务与过盾共用同一份地址与 fetch，不要各建一份。
 *
 * 空串回退 SDK 默认地址：否则会拼出相对 URL，请求打到当前页面上。
 */
export function createMiaoClient(baseUrl: string): MiaoClient {
  const trimmed = baseUrl.trim()
  return new MiaoClient({
    baseUrl: trimmed || undefined,
    fetch: gmFetch
  })
}
