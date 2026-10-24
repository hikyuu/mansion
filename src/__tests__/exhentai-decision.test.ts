import { describe, expect, it, vi } from 'vitest'
import { HentaiArchiveStatus, type HentaiArchiveDto } from '@/dao/hentai-archive'
import { decideGalleryEntry, type GalleryEntryInput } from '@/site/exhentai/exhentai-decision'

vi.mock('@/store/user-store', () => ({ useUserStore: vi.fn<() => unknown>() }))

const GALLERY_DATE = new Date('2026-10-01T00:00:00Z')

function archive(status: HentaiArchiveStatus, date: Date, createdTime: Date = date): HentaiArchiveDto {
  return {
    id: 0,
    gid: 123,
    user_id: 'user',
    date,
    created_time: createdTime,
    status,
    title: '标题',
    title_hash: 'hash'
  }
}

function input(overrides: Partial<GalleryEntryInput> = {}): GalleryEntryInput {
  return {
    archives: [],
    galleryDate: GALLERY_DATE,
    hasTorrent: true,
    skipRead: false,
    onlyShowDownloadable: false,
    ...overrides
  }
}

describe('decideGalleryEntry — 无归档', () => {
  it('有种子 → ready', () => {
    expect(decideGalleryEntry(input())).toMatchObject({ kind: 'ready', hidden: false })
  })

  it('无种子 → no-torrent，不整条隐藏', () => {
    expect(decideGalleryEntry(input({ hasTorrent: false }))).toMatchObject({ kind: 'no-torrent', hidden: false })
  })

  it('无种子 + 仅显示可下载 → no-torrent 且整条隐藏', () => {
    expect(decideGalleryEntry(input({ hasTorrent: false, onlyShowDownloadable: true }))).toMatchObject({
      kind: 'no-torrent',
      hidden: true
    })
  })
})

describe('decideGalleryEntry — 400 用户跳过', () => {
  const skipped = [archive(HentaiArchiveStatus.SkipDownload, GALLERY_DATE)]

  it('默认不隐藏，但不绑定不入队', () => {
    expect(decideGalleryEntry(input({ archives: skipped }))).toMatchObject({
      kind: 'skip-download',
      hidden: false,
      reason: '用户标记跳过下载'
    })
  })

  it('跳过已读 → 整条隐藏', () => {
    expect(decideGalleryEntry(input({ archives: skipped, skipRead: true }))).toMatchObject({
      kind: 'skip-download',
      hidden: true
    })
  })

  it('仅显示可下载 → 整条隐藏', () => {
    expect(decideGalleryEntry(input({ archives: skipped, onlyShowDownloadable: true }))).toMatchObject({
      kind: 'skip-download',
      hidden: true
    })
  })

  it('优先级高于无种子', () => {
    expect(decideGalleryEntry(input({ archives: skipped, hasTorrent: false }))).toMatchObject({
      kind: 'skip-download'
    })
  })
})

describe('decideGalleryEntry — 304 过时种子', () => {
  const stale = [archive(HentaiArchiveStatus.NoNewerSeed, GALLERY_DATE)]

  it('有种子 → stale-seed，不整条隐藏（仍需绑定入队）', () => {
    expect(decideGalleryEntry(input({ archives: stale }))).toMatchObject({
      kind: 'stale-seed',
      hidden: false,
      reason: '只拿到过时种子'
    })
  })

  it('仅显示可下载 → 整条隐藏，但仍是 stale-seed（入队复查不丢）', () => {
    expect(decideGalleryEntry(input({ archives: stale, onlyShowDownloadable: true }))).toMatchObject({
      kind: 'stale-seed',
      hidden: true
    })
  })

  it('无种子 → no-torrent（不会误入队）', () => {
    expect(decideGalleryEntry(input({ archives: stale, hasTorrent: false }))).toMatchObject({
      kind: 'no-torrent'
    })
  })

  it('最后一次操作是 304 时，更早的 200 不改变结局', () => {
    const older = archive(HentaiArchiveStatus.DownloadSuccess, new Date('2026-09-01T00:00:00Z'))
    const latest = archive(
      HentaiArchiveStatus.NoNewerSeed,
      new Date('2026-09-20T00:00:00Z'),
      new Date('2026-10-02T00:00:00Z')
    )
    expect(decideGalleryEntry(input({ archives: [older, latest] }))).toMatchObject({ kind: 'stale-seed' })
  })
})

describe('decideGalleryEntry — 200 已交付', () => {
  it('画廊日期等于水位线 → up-to-date', () => {
    const archives = [archive(HentaiArchiveStatus.DownloadSuccess, GALLERY_DATE)]
    expect(decideGalleryEntry(input({ archives }))).toMatchObject({
      kind: 'up-to-date',
      hidden: false,
      reason: '已下载且无新版本'
    })
  })

  it('画廊日期比水位线新 → ready', () => {
    const archives = [archive(HentaiArchiveStatus.DownloadSuccess, new Date('2026-09-01T00:00:00Z'))]
    expect(decideGalleryEntry(input({ archives }))).toMatchObject({ kind: 'ready', hidden: false })
  })

  it('仅显示可下载 + 无新版本 → 整条隐藏', () => {
    const archives = [archive(HentaiArchiveStatus.DownloadSuccess, GALLERY_DATE)]
    expect(decideGalleryEntry(input({ archives, onlyShowDownloadable: true }))).toMatchObject({
      kind: 'up-to-date',
      hidden: true
    })
  })

  it('水位线取 200/304 的最大日期：被更晚的 304 抬高后判为无新版本', () => {
    const downloaded = archive(
      HentaiArchiveStatus.DownloadSuccess,
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-10-05T00:00:00Z')
    )
    const staleLater = archive(
      HentaiArchiveStatus.NoNewerSeed,
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-09-10T00:00:00Z')
    )
    // 最后一次操作是 200（created_time 更新），但水位线是 304 的 10-01
    expect(decideGalleryEntry(input({ archives: [downloaded, staleLater] }))).toMatchObject({
      kind: 'up-to-date'
    })
  })

  it('画廊日期缺失 → 视为无新版本', () => {
    const archives = [archive(HentaiArchiveStatus.DownloadSuccess, new Date('2026-09-01T00:00:00Z'))]
    expect(decideGalleryEntry(input({ archives, galleryDate: null }))).toMatchObject({ kind: 'up-to-date' })
  })
})
