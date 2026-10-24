import dayjs from 'dayjs'
import { FORMAT } from '@/dictionary'
import { extractSerialNumber, parseSerialNumber } from '@/common/serial-number'
import type { Selector } from '@/waterfall/waterfall'

/**
 * 妹妹条目：列表页 DOM 里的一条妹妹，读出来之后的样子。
 *
 * 「这条妹妹是谁、什么时候发的」这件事只在这里回答。站点之间的差异全部收进 `Selector`，
 * 站点不再各自实现「从哪个元素读番号 / 怎么算路径日期」。
 */
export interface SisterEntry {
  /** 番号身份（见 CONTEXT.md「番号」）：store 的 key 与浏览历史的主键 */
  serialNumber: string
  /** 列表页上的发布日期原文，未解析 */
  date: string
  /** 浏览历史的路径日期；本页拿不到时为 undefined，由站点在详情页回调里补 */
  pathDate?: string
}

/**
 * 从一条妹妹的 DOM 读出它的身份。
 * 读不到番号返回 undefined —— 页面上有几条不认字是正常结局，不是错误。
 */
export function parseSister(item: JQuery, selector: Selector): SisterEntry | undefined {
  const serialNumber = resolveSerialNumber(item, selector)
  if (serialNumber === undefined) return undefined

  const date = readText(item, selector.date)
  return { serialNumber, date, pathDate: resolvePathDate(item, selector, date) }
}

function readText(item: JQuery, selector: string): string {
  return item.find(selector).first().text().trim()
}

/**
 * 番号放在哪个元素里、写成了什么形状，各站不同：
 * 有的站点只放番号本身，有的把标题和番号写在同一段文本里（javstore）。
 * 所以先按文本抽取，抽不出来再把整段当番号 —— 抽取失败的后果比误判轻。
 */
function resolveSerialNumber(item: JQuery, selector: Selector): string | undefined {
  const text = readText(item, selector.serialNumber)
  if (!text) return undefined
  return extractSerialNumber(text) ?? parseSerialNumber(text).identity
}

function resolvePathDate(item: JQuery, selector: Selector, date: string): string | undefined {
  switch (selector.pathDateFrom) {
    case 'dateText': {
      const parsed = dayjs(date)
      return parsed.isValid() ? parsed.format(FORMAT.PATH_DATE) : undefined
    }
    case 'href': {
      const href = item.find(selector.date).first().attr('href')
      return href || undefined
    }
    default:
      return undefined
  }
}
