import { describe, expect, it } from 'vitest'
import {
  HentaiArchiveStatus,
  isNewerThanWaterline,
  resolveArchiveWaterline,
  type HentaiArchiveDto
} from '@/dao/hentai-archive'

function archive(date: string, status: HentaiArchiveStatus, createdTime = date): HentaiArchiveDto {
  return {
    id: 1,
    gid: 1,
    date: new Date(date),
    user_id: 'test-user',
    created_time: new Date(createdTime),
    status,
    title: 'gallery',
    title_hash: 'hash'
  }
}

describe('判重水位线', () => {
  it('只在 200 / 304 里取最大 date，400（用户跳过）不参与', () => {
    const waterline = resolveArchiveWaterline([
      archive('2026-10-01', HentaiArchiveStatus.DownloadSuccess),
      archive('2026-10-05', HentaiArchiveStatus.NoNewerSeed),
      archive('2026-10-20', HentaiArchiveStatus.SkipDownload)
    ])

    expect(waterline?.date.toISOString()).toBe(new Date('2026-10-05').toISOString())
  })

  it('只有 400 或没有记录时，水位线为空', () => {
    expect(resolveArchiveWaterline([archive('2026-10-20', HentaiArchiveStatus.SkipDownload)])).toBeNull()
    expect(resolveArchiveWaterline(undefined)).toBeNull()
  })

  it('用 date 而不是 created_time 当水位线', () => {
    const waterline = resolveArchiveWaterline([
      // 先写下的但画廊日期更新
      archive('2026-10-20', HentaiArchiveStatus.DownloadSuccess, '2026-10-01T00:00:00.000Z'),
      // 后写下的但种子日期更旧
      archive('2026-10-05', HentaiArchiveStatus.NoNewerSeed, '2026-10-09T00:00:00.000Z')
    ])

    expect(waterline?.date.toISOString()).toBe(new Date('2026-10-20').toISOString())
  })
})

describe('isNewerThanWaterline', () => {
  const waterline = archive('2026-10-05', HentaiArchiveStatus.DownloadSuccess)

  it('严格新于水位线才算新版本', () => {
    expect(isNewerThanWaterline(new Date('2026-10-06'), waterline)).toBe(true)
    expect(isNewerThanWaterline(new Date('2026-10-05'), waterline)).toBe(false)
    expect(isNewerThanWaterline(new Date('2026-10-04'), waterline)).toBe(false)
  })

  it('缺少日期或水位线时一律按「不新」处理：宁可不下载，也不重复下载', () => {
    expect(isNewerThanWaterline(null, waterline)).toBe(false)
    expect(isNewerThanWaterline(undefined, waterline)).toBe(false)
    expect(isNewerThanWaterline(new Date('2026-10-06'), null)).toBe(false)
  })
})
