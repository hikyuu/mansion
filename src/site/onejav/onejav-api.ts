import { request } from '@/common/common'
import { type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import { ElNotification } from 'element-plus'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'
import { download } from '@/download'

const baseUrl = 'https://onejav.com'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function downloadFromOnejav(detailUrl: string, retry: number = 3) {
  const fullUrl = baseUrl + detailUrl

  return request(fullUrl, 'https://onejav.com/').then(async (res: GmResponseEvent<'document'>) => {
    // console.log('请求详情页', fullUrl, res.finalUrl)
    if (res.finalUrl === fullUrl) {
      download(fullUrl)
      return
    }

    if (res.finalUrl.includes('file.onejav.com')) {
      download(res.finalUrl)
      return
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
    // console.log('下载链接', link)
    if (!link) {
      ElNotification({ title: 'onejav', message: '下载链接无效', type: 'error' })
      return Promise.reject('下载链接无效')
    }
    download(baseUrl + link)
  })
}
