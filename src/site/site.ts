import { Javdb } from '@/site/javdb/javdb'
import type { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'

export function getSite(): SiteAbstract | undefined {
  if (/(onejav)/g.test(location.href)) {
    return new Onejav()
  }
  if (/(javdb)/g.test(location.href)) {
    return new Javdb()
  }
  return undefined
}

export declare interface Theme {
  PRIMARY_COLOR: string
  SECONDARY_COLOR: string
  WARNING_COLOR: string
}
export { getDetailFromJavStore } from '@/site/javstore/javstore-api'
