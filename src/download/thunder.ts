import { monkeyWindow } from 'vite-plugin-monkey/dist/client'

/**
 * 迅雷协议建任务。
 * 只负责调用与日志：通知由下载意图层统一出（标题=番号，正文含来源与通道），
 * 避免同一件事出现「迅雷下载」和「番号」两张通知。
 * @returns 是否调用成功（thunderLink.newTask 未抛错）
 */
export function thunderDownload(originalUrl: string): boolean {
  try {
    monkeyWindow.thunderLink.newTask({
      tasks: [{ url: originalUrl }]
    })
    return true
  } catch (reason) {
    console.error('[thunder] 建任务失败', { url: originalUrl, reason })
    return false
  }
}
