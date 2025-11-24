import { ElNotification } from 'element-plus'

export function thunderDownload(originalUrl: string) {
  try {
    window.thunderLink.newTask({
      tasks: [{ url: originalUrl }]
    })
    ElNotification({ title: '迅雷下载', message: '迅雷下载已添加到迅雷任务列表', type: 'success' })
  } catch (reason) {
    ElNotification({ title: '迅雷下载', message: '迅雷下载失败' + reason, type: 'error' })
  }
}
