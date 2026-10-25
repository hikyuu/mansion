// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handoffToBrowser } from '@/download/browser.ts'

const mocks = vi.hoisted(() => ({ openInTab: vi.fn<(url: string, options?: unknown) => unknown>() }))

vi.mock('vite-plugin-monkey/dist/client', () => ({ GM_openInTab: mocks.openInTab }))

const URL_TORRENT = 'https://onejav.com/torrent/a/download/1/a.torrent'

beforeEach(() => {
  mocks.openInTab.mockReset()
  vi.restoreAllMocks()
})

describe('handoffToBrowser', () => {
  it('优先走油猴的 GM_openInTab：不受异步链路的弹窗拦截', () => {
    mocks.openInTab.mockReturnValue({ close: vi.fn<() => void>() })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    expect(handoffToBrowser(URL_TORRENT)).toBe('tab')
    expect(mocks.openInTab).toHaveBeenCalledWith(URL_TORRENT, expect.any(Object))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('GM_openInTab 不可用时退回 window.open', () => {
    mocks.openInTab.mockImplementation(() => {
      throw new Error('GM_openInTab 不可用')
    })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    expect(handoffToBrowser(URL_TORRENT)).toBe('tab')
    expect(openSpy).toHaveBeenCalledWith(URL_TORRENT, '_blank')
  })

  it('两者都不可用时退化为当前页导航（仍能让浏览器过验证并下载）', () => {
    mocks.openInTab.mockImplementation(() => {
      throw new Error('GM_openInTab 不可用')
    })
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {})

    expect(handoffToBrowser(URL_TORRENT)).toBe('same-tab')
    expect(assignSpy).toHaveBeenCalledWith(URL_TORRENT)
  })
})
