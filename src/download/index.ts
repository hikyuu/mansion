import { useConfigStore } from '@/store/config-store.ts'
import { thunderDownload } from '@/download/thunder.ts'
import { copyUrl } from '@/download/clipboard.ts'

export function download(url: string) {
  switch (useConfigStore().currentConfig.downloadMethod) {
    case 0:
      thunderDownload(url)
      break
    case 1:
      copyUrl(url)
      break
  }
}
