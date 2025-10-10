import { defineStore } from 'pinia'
import { SiteAbstract } from '@/site/site-abstract.ts'
import { ElNotification } from 'element-plus'

export const useSiteStore = defineStore('site', {
  state: (): {
    site: SiteAbstract | undefined
  } => {
    return {
      site: undefined
    }
  },
  getters: {
    getSite(): SiteAbstract {
      if (this.site === undefined) {
        ElNotification({ title: 'site', message: 'site is undefined', type: 'error' })
        throw new Error('site is undefined')
      }
      return <SiteAbstract>this.site
    }
  },
  actions: {
    setSite(site: SiteAbstract) {
      this.site = site
    }
  }
})
