import jquery from 'jquery'
import { request } from '@/common/common'
import type { Dayjs } from 'dayjs'

export interface TorrentEntry {
  dateText: string
  href: string
  parsedDate?: Dayjs
}

export interface FirstTorrentResult {
  latest: TorrentEntry | null
  outdated: TorrentEntry[]
  error?: string
}

/**
 * 解析 form 中的 torrent 信息，返回 { dateText, href } 或 null
 */
function parseTorrentFromForm($form: JQuery<any>): TorrentEntry | null {
  // 找到 Posted: 后面的日期 span
  let dateText = ''
  const $postedBold = $form
    .find('span')
    .filter((_i, el) => {
      return jquery(el).text().trim() === 'Posted:'
    })
    .first()
  if ($postedBold.length > 0) {
    const $dateSpan = $postedBold.next('span').first()
    if ($dateSpan.length > 0) {
      dateText = $dateSpan.text().trim()
    }
  }

  // 找下载链接（优先 .torrent/.zip 或 /torrent/ 路径）
  let $anchor = $form.find('a[href$=".torrent"], a[href$=".zip"], a[href*="/torrent/"]').first()
  if ($anchor.length === 0) {
    $anchor = $form.find('a').first()
  }
  if ($anchor.length === 0) return null

  const onclick = $anchor.attr('onclick') || ''
  const match = onclick.match(/document\.location\s*=\s*['"]([^'"]+)['"]/i)
  const href = match && match[1] ? match[1] : $anchor.attr('href') || null
  if (!href) return null

  return { dateText, href }
}

/**
 * 判断 form 中的日期是否过时（style="color:red"）
 */
function isFormOutdated($form: JQuery<any>): boolean {
  const $postedBold = $form
    .find('span')
    .filter((_i, el) => {
      return jquery(el).text().trim() === 'Posted:'
    })
    .first()
  if ($postedBold.length > 0) {
    const $dateSpan = $postedBold.next('span').first()
    if ($dateSpan.length > 0) {
      const styleAttr = $dateSpan.attr('style') || ''
      return /color\s*:\s*red/i.test(styleAttr)
    }
  }
  return false
}

export async function fetchTorrentsFromDownloadPage(downloadPageUrl: string): Promise<FirstTorrentResult> {
  try {
    const res = await request(downloadPageUrl, 'https://exhentai.org/', -1)
    if (!res || (res.status && res.status !== 200)) {
      return { latest: null, outdated: [], error: `HTTP ${res?.status ?? 'ERR'}` }
    }
    const text = (res as any).responseText || ''
    const $doc = jquery(text)

    // 优先找表单列表（每个 torrent 一项）
    const $forms = $doc.find('form')
    if ($forms.length === 0) {
      // 兜底：直接找页面中的 torrent 链接
      const $anchor = $doc.find('a[href$=".torrent"], a[href$=".zip"], a[href*="/torrent/"]').first()
      if ($anchor.length === 0) return { latest: null, outdated: [], error: '没有找到下载链接' }
      const onclick = $anchor.attr('onclick') || ''
      const match = onclick.match(/document\.location\s*=\s*['"]([^'"]+)['"]/i)
      const href = match && match[1] ? match[1] : $anchor.attr('href') || null
      if (!href) return { latest: null, outdated: [], error: '没有找到下载链接' }
      return { latest: { dateText: '', href }, outdated: [] }
    }

    // 遍历所有 form，分类为 latest 和 outdated
    let latest: TorrentEntry | null = null
    const outdated: TorrentEntry[] = []

    $forms.each((_i, formEl) => {
      const $form = jquery(formEl)
      const entry = parseTorrentFromForm($form)
      if (!entry) return

      if (isFormOutdated($form)) {
        outdated.push(entry)
      } else if (!latest) {
        // 第一个非过时的作为 latest
        latest = entry
      }
    })

    return { latest, outdated }
  } catch (e: any) {
    return { latest: null, outdated: [], error: e?.message || String(e) }
  }
}
