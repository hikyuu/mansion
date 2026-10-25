import { describe, expect, it } from 'vitest'
import { isDefaultSelected, isVideoFile } from '@/download/file-picker.ts'

const MB = 1024 * 1024

function fileOf(path: string, size: number) {
  return { index: 0, path, size }
}

describe('isVideoFile', () => {
  it('识别常见视频扩展名，大小写不敏感', () => {
    expect(isVideoFile('ABF-274.mp4')).toBe(true)
    expect(isVideoFile('ABF-274.MKV')).toBe(true)
    expect(isVideoFile('disc/VIDEO_TS/VTS_01_1.VOB')).toBe(true)
    expect(isVideoFile('a/b/c.m2ts')).toBe(true)
    expect(isVideoFile('预览.webm')).toBe(true)
  })

  it('只看文件名部分，不受目录名影响', () => {
    expect(isVideoFile('合集.mp4/readme.txt')).toBe(false)
    expect(isVideoFile('合集.mp4/正片.mp4')).toBe(true)
    expect(isVideoFile('D:\\downloads\\x.rmvb')).toBe(true)
  })

  it('非视频与无扩展名不算视频', () => {
    expect(isVideoFile('cover.jpg')).toBe(false)
    expect(isVideoFile('说明.txt')).toBe(false)
    expect(isVideoFile('README')).toBe(false)
    expect(isVideoFile('.hidden')).toBe(false)
    expect(isVideoFile('')).toBe(false)
  })
})

describe('isDefaultSelected', () => {
  it('大于 100 MB 的视频默认勾选', () => {
    expect(isDefaultSelected(fileOf('ABF-274.mp4', 101 * MB))).toBe(true)
    expect(isDefaultSelected(fileOf('ABF-274.mkv', 4 * 1024 * MB))).toBe(true)
  })

  it('刚好 100 MB 与更小的视频不勾选', () => {
    expect(isDefaultSelected(fileOf('sample.mp4', 100 * MB))).toBe(false)
    expect(isDefaultSelected(fileOf('trailer.mp4', 20 * MB))).toBe(false)
  })

  it('大体积的非视频文件不勾选', () => {
    expect(isDefaultSelected(fileOf('cover.jpg', 300 * MB))).toBe(false)
    expect(isDefaultSelected(fileOf('notes.txt', 300 * MB))).toBe(false)
  })
})
