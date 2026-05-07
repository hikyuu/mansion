import jquery from 'jquery'
import { request } from '@/common/common'

export interface FirstTorrentResult {
  href: string | null
  isOutdated: boolean
  dateText?: string
  error?: string
}

export async function fetchFirstTorrentFromDownloadPage(downloadPageUrl: string): Promise<FirstTorrentResult> {
  try {
    const res = await request(downloadPageUrl, 'https://exhentai.org/', -1)
    if (!res || (res.status && res.status !== 200)) {
      return { href: null, isOutdated: false, error: `HTTP ${res?.status ?? 'ERR'}` }
    }
    const text = (res as any).responseText || ''
    const $doc = jquery(text)

    // 优先找表单列表（每个 torrent 一项）
    const $forms = $doc.find('form')
    if ($forms.length === 0) {
      // 兜底：直接找页面中的 torrent 链接
      const $anchor = $doc.find('a[href$=".torrent"], a[href$=".zip"], a[href*="/torrent/"]').first()
      if ($anchor.length === 0) return { href: null, isOutdated: false, error: '没有找到下载链接' }
      const onclick = $anchor.attr('onclick') || ''
      const match = onclick.match(/document\.location\s*=\s*['"]([^'"]+)['"]/i)
      const href = match && match[1] ? match[1] : $anchor.attr('href') || null
      return { href, isOutdated: false }
    }

    const $firstForm = $forms.first()

    // 找到 Posted: 后面的日期 span，检查是否带有 style="color:red"
    let isOutdated = false
    let dateText: string | undefined
    const $postedBold = $firstForm
      .find('span')
      .filter((i, el) => {
        return jquery(el).text().trim() === 'Posted:'
      })
      .first()
    if ($postedBold.length > 0) {
      const $dateSpan = $postedBold.next('span').first()
      if ($dateSpan.length > 0) {
        dateText = $dateSpan.text().trim()
        const styleAttr = $dateSpan.attr('style') || ''
        if (/color\s*:\s*red/i.test(styleAttr)) isOutdated = true
      }
    }

    // 找第一个下载链接（优先 .torrent/.zip 或 /torrent/ 路径）
    let $anchor = $firstForm.find('a[href$=".torrent"], a[href$=".zip"], a[href*="/torrent/"]').first()
    if ($anchor.length === 0) {
      $anchor = $firstForm.find('a').first()
    }
    if ($anchor.length === 0) return { href: null, isOutdated, dateText, error: '没有找到下载链接' }

    const onclick = $anchor.attr('onclick') || ''
    const match = onclick.match(/document\.location\s*=\s*['"]([^'"]+)['"]/i)
    const href = match && match[1] ? match[1] : $anchor.attr('href') || null

    return { href, isOutdated, dateText }
  } catch (e: any) {
    return { href: null, isOutdated: false, error: e?.message || String(e) }
  }
}
