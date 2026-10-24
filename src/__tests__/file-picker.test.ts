import { describe, expect, it } from 'vitest'
import { isVideoFile } from '@/download/file-picker.ts'

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
