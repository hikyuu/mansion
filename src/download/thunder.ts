import { ElNotification } from 'element-plus'
import { useSiteStore } from '@/store/site-store.ts'

let onload = false

loadScript()

export function thunderDownload(originalUrl: string) {
  if (!onload) {
    ElNotification({ title: useSiteStore().getSite.name, message: '正在加载迅雷下载组件，请稍后再试', type: 'info' })
  }
  // clickMagnet(generateThunderLink(originalUrl))
  window.thunderLink.newTask({
    tasks: [{ url: originalUrl }]
  })
}
function loadScript() {
  return new Promise(() => {
    if (onload) {
      return resolve()
    }
    const script = document.createElement('script')
    script.src = '//open.thunderurl.com/thunder-link.js'
    script.onload = () => resolve()
    document.head.appendChild(script)
  })
}

function resolve() {
  onload = true
  ElNotification({ title: useSiteStore().getSite.name, message: '迅雷组件加载成功', type: 'success' })
}
