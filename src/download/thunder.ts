import { ElNotification } from 'element-plus'
import { monkeyWindow } from 'vite-plugin-monkey/dist/client'

/**
 * 迅雷协议建任务。
 * @param options.silent 回退场景由调用方统一出通知，置 true 关闭本函数内通知
 * @returns 是否调用成功（thunderLink.newTask 未抛错）
 */
export function thunderDownload(originalUrl: string, options: { silent?: boolean } = {}): boolean {
  try {
    monkeyWindow.thunderLink.newTask({
      tasks: [{ url: originalUrl }]
    })
    if (!options.silent) {
      ElNotification({ title: '迅雷下载', message: '已添加到迅雷任务列表', type: 'success' })
    }
    return true
  } catch (reason) {
    console.error('[thunder] 建任务失败', { url: originalUrl, reason })
    if (!options.silent) {
      ElNotification({ title: '迅雷下载', message: '迅雷下载失败' + reason, type: 'error' })
    }
    return false
  }
}
