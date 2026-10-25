import { GM_openInTab } from 'vite-plugin-monkey/dist/client'

/** 交给浏览器后的落地方式：新标签 / 当前页导航 */
export type BrowserHandoffMode = 'tab' | 'same-tab'

/**
 * 把地址交给浏览器自己打开。
 *
 * 为什么不直接在脚本里请求：onejav 的种子链接在 Turnstile 后面，只有顶层导航
 * （sec-fetch-dest: document + 完整浏览器指纹）能通过，XHR / fetch / GM 请求一律 403。
 *
 * 顺序：GM_openInTab（扩展通道，不受「异步链路已丢用户手势」的弹窗拦截）→ window.open → 当前页导航。
 * 前两步能保住当前页面；最后一步会离开页面，但没有别的办法让浏览器发起导航。
 */
export function handoffToBrowser(url: string): BrowserHandoffMode {
  try {
    GM_openInTab(url, { active: true, insert: true, setParent: true })
    return 'tab'
  } catch {
    // 扩展接口不可用（或非油猴环境），继续降级
  }

  if (window.open(url, '_blank')) return 'tab'

  window.location.assign(url)
  return 'same-tab'
}
