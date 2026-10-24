import { describe, expect, it } from 'vitest'
import { extractSerialNumber, parseSerialNumber } from '@/common/serial-number'
import { ProjectError } from '@/common/errors'

describe('番号 · 身份', () => {
  it('去掉空白与分隔符，保留大小写', () => {
    expect(parseSerialNumber('ABF-274').identity).toBe('ABF274')
    expect(parseSerialNumber('abf_274').identity).toBe('abf274')
    expect(parseSerialNumber(' ABF - 274 ').identity).toBe('ABF274')
    expect(parseSerialNumber('ABF-\r\n274').identity).toBe('ABF274')
  })

  it('多个分隔符也全部去掉', () => {
    expect(parseSerialNumber('ABC-123-456').identity).toBe('ABC123456')
  })

  it('原文保留，便于日志追溯', () => {
    expect(parseSerialNumber('ABF-274').raw).toBe('ABF-274')
  })
})

describe('番号 · 归档键', () => {
  it('身份之上压平 FC2 前缀并统一大写', () => {
    expect(parseSerialNumber('FC2PPV123').archiveKey).toBe('FC2123')
    expect(parseSerialNumber('fc2-ppv-123').archiveKey).toBe('FC2123')
    expect(parseSerialNumber('abf-274').archiveKey).toBe('ABF274')
  })

  it('去掉番号开头的纯数字段', () => {
    expect(parseSerialNumber('123ABF456').archiveKey).toBe('ABF456')
  })

  it('普通番号的归档键与身份一致', () => {
    const serial = parseSerialNumber('ABF-274')
    expect(serial.archiveKey).toBe(serial.identity)
  })

  it('FC2 的归档键与身份不同 —— 这是归档表的历史口径', () => {
    const serial = parseSerialNumber('FC2PPV123')
    expect(serial.archiveKey).toBe('FC2123')
    expect(serial.identity).toBe('FC2PPV123')
  })
})

describe('番号 · FC2 判定', () => {
  it('三种写法都认', () => {
    expect(parseSerialNumber('FC2PPV123').isFc2).toBe(true)
    expect(parseSerialNumber('fc2-ppv-123').isFc2).toBe(true)
    expect(parseSerialNumber('FC2_PPV_123').isFc2).toBe(true)
  })

  it('归档键形态不再被认作 FC2', () => {
    expect(parseSerialNumber('FC2123').isFc2).toBe(false)
  })
})

describe('番号 · 搜索变体', () => {
  it('字母数字番号按 type 换大小写', () => {
    expect(parseSerialNumber('ABF274').searchVariant(0)).toBe('AbF-274')
    expect(parseSerialNumber('ABF274').searchVariant(1)).toBe('aBf-274')
  })

  it('全数字番号按 type 换连接符', () => {
    expect(parseSerialNumber('123456789').searchVariant(0)).toBe('123456-789')
    expect(parseSerialNumber('123456789').searchVariant(1)).toBe('123456_789')
    expect(parseSerialNumber('123456789').searchVariant(2)).toBe('123456789')
  })

  it('FC2 的搜索变体', () => {
    expect(parseSerialNumber('FC2PPV123').searchVariant(0)).toBe('Fc2-PpV-123')
    expect(parseSerialNumber('FC2PPV123').searchVariant(2)).toBe('FC2PPV-123')
  })

  it('数字开头的番号带上前导数字', () => {
    expect(parseSerialNumber('123ABCD456').searchVariant(0)).toBe('123AbCd-456')
  })

  it('认不出的格式抛 ProjectError —— 调用方靠这个异常走「没找到」', () => {
    expect(() => parseSerialNumber('ABC').searchVariant(0)).toThrow(ProjectError)
  })

  it('只读身份、不碰搜索变体时不会抛错', () => {
    expect(parseSerialNumber('ABC').identity).toBe('ABC')
  })
})

describe('番号 · javdb 变体', () => {
  it('全数字番号用下划线，与搜索变体不同', () => {
    expect(parseSerialNumber('123456789').javdbVariant()).toBe('123456_789')
    expect(parseSerialNumber('123456789').searchVariant(0)).toBe('123456-789')
  })

  it('字母数字番号与搜索变体 type 0 一致', () => {
    expect(parseSerialNumber('ABF274').javdbVariant()).toBe('AbF-274')
  })
})

describe('番号 · 从文本抽取', () => {
  it('从标题里抽普通番号', () => {
    expect(extractSerialNumber('【高清】ABF-274 某某作品')).toBe('ABF274')
  })

  it('从标题里抽 FC2 的三种写法', () => {
    expect(extractSerialNumber('FC2-PPV-1234567 素人')).toBe('FC2PPV1234567')
    expect(extractSerialNumber('fc2ppv1234567')).toBe('FC2PPV1234567')
    expect(extractSerialNumber('FC2 PPV 1234567')).toBe('FC2PPV1234567')
  })

  it('抽不到返回 undefined，而不是抛错', () => {
    expect(extractSerialNumber('毫无番号')).toBeUndefined()
    expect(extractSerialNumber('')).toBeUndefined()
  })

  it('抽出来的已经是身份，再归一化一次不变', () => {
    const once = extractSerialNumber('ABF-274 某某')!
    expect(parseSerialNumber(once).identity).toBe(once)
  })
})
