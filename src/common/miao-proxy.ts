/**
 * 把「过盾请求」整体外包给 miao 的接口层：只约定能力形状，不关心实现。
 *
 * 为什么不是「拿凭证自己发」：`GM_xmlhttpRequest` 不能改 `User-Agent`（浏览器保留头，
 * 脚本管理器会丢掉），而 `cf_clearance` 绑定过盾浏览器的 UA；FlareSolverr 的
 * `request.get` 也没有 `userAgent` 参数，两边 UA 无从对齐 —— 自己带着凭证发等于
 * 换个 UA 重新触发挑战。所以两个能力都由 miao 代做：
 * - 页面：`web.fetch`（服务端真浏览器，能过 Turnstile）；
 * - 字节：`web.download`（`mode: 'auto'`，先纯 HTTP，撞挑战由服务端降级到浏览器下载栈）。
 *
 * 实现见 `@/download/miao-proxy.ts`。
 */

/** 代取页面：服务端过盾后直接回 HTML */
export interface PageFetchResult {
  /** 跟随重定向后的最终 URL */
  url: string
  status: number
  html: string
  contentType: string | null
}

/** 代下载二进制：字节以 base64 回传（脚本侧不能替它解成 Blob 再上传） */
export interface BinaryFetchResult {
  url: string
  status: number
  contentType: string | null
  /** 解码后的字节数 */
  size: number
  base64: string
}

/** 统一的失败形状：`reason` 是给用户看的一句话，不含 cookie 等敏感内容 */
export interface ProxyFailure {
  ok: false
  reason: string
}

export type ProxyResult<T> = ({ ok: true } & T) | ProxyFailure

/**
 * 页面取回通道。
 *
 * 约定**不抛错**：任何失败折成 `{ ok: false, reason }`，调用方统一按「没取到」处理。
 */
export type PageFetchProvider = (url: string) => Promise<ProxyResult<PageFetchResult>>

/** 字节取回通道，约定同上 */
export type BinaryFetchProvider = (url: string) => Promise<ProxyResult<BinaryFetchResult>>

/**
 * 调一次通道。
 *
 * 通道约定的「不抛错」由它兜住：通道自己炸了也折成失败结果，
 * 调用方只需看 `ok`，不必在下载主链路上再写一层 try。
 * 没给通道时返回 `null`（= 这条链路本来就不走 miao）。
 */
export async function tryProxy<T>(
  provider: ((url: string) => Promise<ProxyResult<T>>) | undefined,
  url: string
): Promise<ProxyResult<T> | null> {
  if (!provider) return null
  try {
    return await provider(url)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
