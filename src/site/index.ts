import { Javdb } from '@/site/javdb/javdb'
import type { SiteAbstract } from '@/site/site-abstract'
import type { Sister } from '@/site/sister'
import { Onejav } from '@/site/onejav/onejav'

export function getSite(sisters: Sister): SiteAbstract | undefined {
  if (/(onejav)/g.test(location.href)) {
    return new Onejav(sisters)
  }
  if (/(javdb)/g.test(location.href)) {
    return new Javdb(sisters)
  }
  return undefined
}

export declare interface Theme {
  PRIMARY_COLOR: string
  SECONDARY_COLOR: string
  WARNING_COLOR: string
}
export { getDetailFromJavStore } from '@/site/javstore/javstore-api'
