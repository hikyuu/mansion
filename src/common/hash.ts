/**
 * 对字符串计算 sha256，返回小写 hex。
 * 文本为空或当前环境不支持 Web Crypto 时返回空字符串。
 */
export async function sha256Hex(text: string): Promise<string> {
  if (!text) return ''
  try {
    const data = new TextEncoder().encode(text)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return ''
  }
}
