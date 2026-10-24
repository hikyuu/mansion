import { Javdb } from '@/site/javdb/javdb'
import type { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'
import { Javstore } from '@/site/javstore/javstore.ts'
import { Exhentai } from '@/site/exhentai/exhentai'

/**
 * 站点注册项：识别与构造放在一起。
 * 识别只看 hostname（不看路径），避免 URL 子串误判，也避免与站点自身的判据漂移。
 */
interface SiteEntry {
  matches: (hostname: string) => boolean
  create: () => SiteAbstract
}

const ENTRIES: SiteEntry[] = [
  { matches: (host) => host === 'onejav.com' || host.endsWith('.onejav.com'), create: () => new Onejav() },
  { matches: (host) => host === 'javdb.com' || host.endsWith('.javdb.com'), create: () => new Javdb() },
  { matches: (host) => host === 'exhentai.org' || host.endsWith('.exhentai.org'), create: () => new Exhentai() },
  { matches: (host) => host === 'javstore.net' || host.endsWith('.javstore.net'), create: () => new Javstore() }
]

export function getSite(): SiteAbstract | undefined {
  const host = location.hostname.toLowerCase()
  const entry = ENTRIES.find((item) => item.matches(host))
  return entry?.create()
}

export declare interface Theme {
  PRIMARY_COLOR: string
  SECONDARY_COLOR: string
  WARNING_COLOR: string
}
export { getDetailFromJavStore } from '@/site/javstore/javstore-api'
