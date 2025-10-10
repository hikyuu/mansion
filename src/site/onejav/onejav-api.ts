import { request } from '@/common/common'
import { type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import { useClipboard } from '@vueuse/core'
import { ElNotification } from 'element-plus'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'

const baseUrl = 'https://onejav.com'

const { copy, copied, isSupported } = useClipboard()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function downloadFromOnejav(detailUrl: string, retry: number = 3) {
  const fullUrl = baseUrl + detailUrl

  return request(fullUrl, baseUrl).then(async (res: GmResponseEvent<'document'>) => {
    console.log('请求详情页', fullUrl, res.finalUrl)
    if (!isSupported) {
      ElNotification({ title: 'onejav', message: '您的浏览器不支持剪贴板API，请手动点击下载', type: 'error' })
      return Promise.reject('您的浏览器不支持剪贴板API')
    }
    if (res.finalUrl === fullUrl) {
      const result = await copyUrl(fullUrl)
      if (result) return Promise.resolve()
    }

    if (res.finalUrl.includes('file.onejav.com')) {
      const result = await copyUrl(res.finalUrl)
      if (result) return Promise.resolve()
    }

    if (!res.responseXML) {
      return Promise.reject('没有返回HTML')
    }

    const doc = jQuery(res.responseXML)

    const href = doc.find(ONEJAV_DOWNLOAD)
    if (href.length === 0) {
      ElNotification({ title: 'onejav', message: '没有找到下载链接', type: 'error' })
      return Promise.reject('没有找到下载链接')
    }
    const link = href.first().attr('href')
    console.log('下载链接', link)
    if (!link) {
      ElNotification({ title: 'onejav', message: '下载链接无效', type: 'error' })
      return Promise.reject('下载链接无效')
    }

    const result = await copyUrl(baseUrl + link)
    if (result) {
      return Promise.resolve()
    } else {
      return Promise.reject('复制下载链接失败，请手动复制')
    }
  })
}

async function copyUrl(text: string) {
  await copy(text)
  if (copied.value) {
    ElNotification({ title: 'onejav', message: '已经复制详情页链接到剪贴板', type: 'success' })
    return true
  } else {
    ElNotification({ title: 'onejav', message: '复制详情页链接到剪贴板失败，请手动复制', type: 'warning' })
    return false
  }
}
