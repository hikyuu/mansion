import { useSiteStore } from '@/store/site-store.ts'
import { useClipboard } from '@vueuse/core'
import { ElNotification } from 'element-plus'

const { copy, copied, isSupported } = useClipboard()

const waitTime = 1000
const waitQueue: Array<string> = []
let waiting = false

export async function copyUrl(text: string) {
  if (!isSupported) {
    ElNotification({ title: '复制', message: '您的浏览器不支持剪贴板API，请手动复制', type: 'error' })
    return
  }
  if (!useSiteStore().isValid) {
    ElNotification({ title: '复制', message: '站点列表未加载完成，请稍后再试', type: 'error' })
    return
  }
  waitQueue.push(text)
  task()
}

function task() {
  if (waiting) return
  if (waitQueue.length === 0) return
  const text = waitQueue.shift()
  if (!text) {
    task()
    return
  }
  waiting = true
  copy(text).then(() => {
    if (copied.value) {
      ElNotification({ title: useSiteStore().getSite.name, message: '已经复制下载链接到剪贴板', type: 'success' })
    } else {
      ElNotification({
        title: useSiteStore().getSite.name,
        message: '复制下载链接到剪贴板失败，请手动复制',
        type: 'warning'
      })
    }
    setTimeout(() => {
      waiting = false
      task()
    }, waitTime)
  })
}
