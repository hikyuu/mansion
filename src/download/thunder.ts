import $ from 'jquery'
import { ElNotification } from 'element-plus'
import { useSiteStore } from '@/store/site-store.ts'

function generateThunderLink(originalUrl: string) {
  // 迅雷协议的编码格式为：在原URL前后加上特定字符后再进行Base64编码
  const prefix = 'AA'
  const suffix = 'ZZ'
  const encodedUrl = btoa(prefix + originalUrl + suffix)
  return 'thunder://' + encodedUrl
}

function clickMagnet(magnet: string) {
  const $a = $('<a>', {
    href: magnet,
    style: 'display:none;' // 隐藏 a 标签
  }).appendTo('body')
  $a[0]!.click()
  ElNotification({ title: useSiteStore().getSite.name, message: '迅雷下载已开始', type: 'success' })
}

export function thunderDownload(originalUrl: string) {
  clickMagnet(generateThunderLink(originalUrl))
}
