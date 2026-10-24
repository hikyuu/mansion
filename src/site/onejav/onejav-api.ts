import jquery from 'jquery'
import { request } from '@/common/common'
import { type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import { ONEJAV_DOWNLOAD } from '@/site/onejav/onejav.ts'

const baseUrl = 'https://onejav.com'

/**
 * 解析 onejav 详情页的最终下载地址，不做提交（提交由下载意图模块统一负责）。
 * 三种结局：详情页本身就是直链 / 重定向到 file.onejav.com / 页面内 a[title='Download .torrent']。
 * 解析不到返回 null，由调用方统一提示。
 */
export async function resolveOnejavTorrent(detailUrl: string): Promise<string | null> {
  const fullUrl = baseUrl + detailUrl
  const res: GmResponseEvent<'document'> = await request(fullUrl, 'https://onejav.com/')
  if (res.finalUrl === fullUrl) return fullUrl
  if (res.finalUrl.includes('file.onejav.com')) return res.finalUrl
  if (!res.responseXML) return null

  const href = jquery(res.responseXML).find(ONEJAV_DOWNLOAD).first().attr('href')
  if (!href) return null
  return baseUrl + href
}
