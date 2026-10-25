// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSisterStore } from '@/store/sister-store'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_addStyle: vi.fn<(css: string) => void>(),
  GM_xmlhttpRequest: vi.fn(),
  monkeyWindow: {}
}))

vi.mock('element-plus', () => {
  const notification = vi.fn<(options: unknown) => void>()
  return { ElNotification: Object.assign(notification, { error: vi.fn<(options: unknown) => void>() }) }
})

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('sister store · 裁掉的条目不许复活', () => {
  it('已裁掉的番号，迟到的 updateInfo 不会把它建回队列', () => {
    const sister = useSisterStore()
    sister.updateInfo({ serialNumber: 'SN-01' })
    sister.forgetRead(['SN-01'])

    sister.updateInfo({ serialNumber: 'SN-01', src: ['late.svg'] })

    expect(sister.getInfo('SN-01')).toBeUndefined()
    expect(sister.size).toBe(0)
  })

  it('没裁过的新条目照常建：分页里还没插进 DOM 的卡片不受影响', () => {
    const sister = useSisterStore()

    sister.updateInfo({ serialNumber: 'SN-02', src: ['load.svg'] })

    expect(sister.getInfo('SN-02')).toBeDefined()
    expect(sister.size).toBe(1)
  })

  it('同一番号重新出现在页面里时，墓碑撤销、条目重建', () => {
    const sister = useSisterStore()
    sister.updateInfo({ serialNumber: 'SN-03' })
    sister.forgetRead(['SN-03'])
    document.body.innerHTML = '<div id="SN-03"></div>'

    sister.updateInfo({ serialNumber: 'SN-03' })

    expect(sister.getInfo('SN-03')).toBeDefined()
    expect(sister.size).toBe(1)
  })
})
