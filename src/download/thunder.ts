import { ElNotification } from 'element-plus'
import { monkeyWindow } from 'vite-plugin-monkey/dist/client'

export function thunderDownload(originalUrl: string) {
  try {
    monkeyWindow.thunderLink.newTask({
      tasks: [{ url: originalUrl }]
    })
    ElNotification({ title: '迅雷下载', message: '已添加到迅雷任务列表', type: 'success' })
  } catch (reason) {
    ElNotification({ title: '迅雷下载', message: '迅雷下载失败' + reason, type: 'error' })
  }
}
