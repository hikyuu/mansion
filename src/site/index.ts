import { Javdb } from '@/site/javdb/javdb'
import type { SiteAbstract } from '@/site/site-abstract'
import type { Sisters } from '@/site/sisters'
import { Onejav } from '@/site/onejav/onejav'

export function getSite(sisters: Sisters): SiteAbstract | undefined {
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
