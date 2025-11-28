import { thunderDownload } from '@/download/thunder.ts'
import { copyUrl } from '@/download/clipboard.ts'
import { useConfigStore } from '@/store/config-store.ts'

export function download(url: string) {
  switch (useConfigStore().getSiteConfig.downloadMethod) {
    case 0:
      thunderDownload(url)
      break
    case 1:
      copyUrl(url)
      break
  }
}
