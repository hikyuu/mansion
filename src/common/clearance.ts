/**
 * 过盾通道的接口层：只约定「要什么」，不关心「谁来过盾」。
 *
 * 实现方是 miao 的 web 能力（`@hikyuu/thunder-client` 的 `MiaoClient.web.clearance`），
 * 见 `@/download/miao-clearance.ts`。调用方（种子字节、页面抓取）只依赖这里的形状，
 * 单测里塞一个假通道即可，不必拉起 miao。
 */

/**
 * 过盾凭证。
 *
 * `cookie` 与 `userAgent` **必须成对使用**：Cloudflare 的 `cf_clearance` 绑定 UA，
 * 换 UA 会立刻重新触发挑战。
 */
export interface ClearanceTicket {
  /** 即用型 Cookie 请求头（服务端已按 path 长度倒序拼接） */
  cookie: string
  /** 过盾浏览器的 UA，必须随 cookie 一起发 */
  userAgent: string
}

/** 过盾结局：失败时 `reason` 是给用户看的一句话（不含 cookie 等敏感内容） */
export type ClearanceResult = { ok: true; ticket: ClearanceTicket } | { ok: false; reason: string }

/**
 * 过盾通道：给一条 URL，返回可以重新发请求的凭证。
 *
 * 约定：
 * - **不抛错**：任何失败都折成 `{ ok: false, reason }`，调用方统一按「过盾没成功」处理；
 * - 一次调用最多过一次盾，调用方自己保证「只试一次」。
 */
export type ClearanceProvider = (url: string) => Promise<ClearanceResult>

/**
 * 调一次过盾通道。
 *
 * 通道约定的「不抛错」由它兜住：通道自己炸了也折成失败结果，
 * 调用方只需看 `ok`，不必在下载主链路上再写一层 try。
 * 没给通道时返回 `null`（= 本来就不打算过盾）。
 */
export async function tryClearance(
  provider: ClearanceProvider | undefined,
  url: string
): Promise<ClearanceResult | null> {
  if (!provider) return null
  try {
    return await provider(url)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** 站点的 origin（过盾器按 origin 缓存凭证，路径不参与） */
export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
