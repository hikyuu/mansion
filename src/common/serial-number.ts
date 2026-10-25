import { ProjectError } from '@/common/errors.ts'

/**
 * 番号。
 *
 * 一个番号在不同场合要有不同的写法：
 * - **身份**（`identity`）：全局唯一的业务键，store 的 key 与浏览历史的 `serial_number` 都用它；
 * - **归档键**（`archiveKey`）：归档表的主键，在身份基础上再压平 FC2 前缀，与历史行保持一致；
 * - **搜索变体**（`searchVariant`）：站点搜索框要的写法，同一部作品可能有多种变体；
 * - **javdb 变体**（`javdbVariant`）：javdb 搜索专用，全数字番号用下划线连接。
 *
 * 这四种写法与它们背后的正则全部只在这里实现。调用方读属性即可，不再自己写 replace 链。
 * 口径见 CONTEXT.md「番号」。
 */
export interface SerialNumber {
  /** 归一化前的原文 */
  readonly raw: string
  /** 全局身份：去掉空白与分隔符，保留大小写 */
  readonly identity: string
  /** 归档表键：身份再压平 FC2 前缀、去掉开头的纯数字段并统一大写 */
  readonly archiveKey: string
  readonly isFc2: boolean
  /**
   * 站点搜索变体。type 越大越宽松（见各 SeriesFactory 分支），
   * 找不到任何已知格式时抛 ProjectError —— 调用方靠这个异常走「没找到」分支。
   */
  searchVariant(type: number): string
  /** javdb 搜索专用变体：全数字番号用下划线连接 */
  javdbVariant(): string
}

const FC2_REG = /(FC2PPV)(\d+)/i
const FC2_LOOSE_REG = /(FC2)(\S*)(ppv)/i
/** javdb 的列表页只写 `FC2-4997634`，没有 PPV 段 */
const FC2_DASH_REG = /^fc2[-_ ]+(\d+)$/i
const ALPHANUMBER_REG = /(^[a-z].*[a-z])(\d+)/i
const NUMBERBEGIN_REG = /(^\d+)([a-z].*[a-z])(\d+)/i
const ALLDIGIT_REG = /^\d+$/

/** 从标题文本里抽番号：先认 FC2 的三种写法，再用通用的「字母-数字」形状 */
const TEXT_FC2_REG = /fc2[-_ ]?ppv[-_ ]?([0-9]+)/i
const TEXT_SERIAL_REG = /([a-z0-9]+)-([a-z0-9-]+)/i

function identityOf(raw: string): string {
  return raw.replace(/[\r\n]/gi, '').replace(/[\s\-_]/g, '')
}

/**
 * javdb 把 FC2 番号写成 `FC2-4997634`，其它站点写 `FC2-PPV-4997634`。
 * 同一部作品必须有同一个身份，所以这里补回 PPV 段；归档键不受影响（都是 FC2+数字）。
 * 只认带分隔符的写法 —— `FC2123` 是归档键形态，不能倒推回 PPV。
 */
function normalizeFc2(raw: string): string {
  const matched = raw.match(FC2_DASH_REG)
  return matched?.[1] ? 'FC2PPV' + matched[1] : raw
}

function archiveKeyOf(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/fc2[\s\S]?ppv[-_]?/gi, 'fc2')
    .replace(/(^\d+)(?=[a-zA-Z])/g, '')
    .replace(/[-_]/g, '')
    .toUpperCase()
}

function getSeriesFactory(originalId: string): SeriesFactory {
  if (FC2_REG.test(originalId)) return SeriesFactory.FC2PPV
  if (ALLDIGIT_REG.test(originalId)) return SeriesFactory.ALLDIGIT
  if (NUMBERBEGIN_REG.test(originalId)) return SeriesFactory.NUMBERBEGIN
  if (ALPHANUMBER_REG.test(originalId)) return SeriesFactory.ALPHANUMBER
  throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: '番号格式未找到' + originalId })
}

enum SeriesFactory {
  FC2PPV,
  ALPHANUMBER,
  NUMBERBEGIN,
  ALLDIGIT
}

function allDigit(originalId: string, type: number): string {
  const matchResult = originalId.match(/^(\d{6})(\d*)$/)
  if (!matchResult) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'allDigit番号格式错误' + originalId })
  }
  const firstSix = matchResult[1]
  const theRest = matchResult[2]
  switch (type) {
    case 0:
      return firstSix + '-' + theRest
    case 1:
      return firstSix + '_' + theRest
    case 2:
      return originalId
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'allDigit番号所有格式未找到' + originalId })
  }
}

function fc2Ppv(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(FC2_REG)
  if (!cuttingNumber) throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'FC2番号格式错误' + originalId })
  switch (type) {
    case 0:
      return 'Fc2-PpV-' + cuttingNumber[2]
    case 1:
      return 'fC2-pPv-' + cuttingNumber[2]
    case 2:
      return cuttingNumber[1] + '-' + cuttingNumber[2]
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'FC2番号所有格式未找到' + originalId })
  }
}

function alphaNumber(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(ALPHANUMBER_REG)
  if (!cuttingNumber)
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号格式错误' + originalId })
  const alpha = cuttingNumber[1]
  if (!alpha) throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号格式错误' + originalId })
  switch (type) {
    case 0:
      return AaBb(alpha) + '-' + cuttingNumber[2]
    case 1:
      return aAbB(alpha) + '-' + cuttingNumber[2]
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'alphaNumber番号所有格式未找到' + originalId })
  }
}

function numberBegin(originalId: string, type: number): string {
  const cuttingNumber = originalId.match(NUMBERBEGIN_REG)
  if (!cuttingNumber || cuttingNumber.length === 0) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号格式错误' + originalId })
  }
  const alpha = cuttingNumber[2]
  if (!alpha) {
    throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号格式错误' + originalId })
  }
  switch (type) {
    case 0:
      return cuttingNumber[1] + AaBb(alpha) + '-' + cuttingNumber[3]
    case 1:
      return cuttingNumber[1] + aAbB(alpha) + '-' + cuttingNumber[3]
    case 2:
      return AaBb(alpha) + '-' + cuttingNumber[3]
    case 3:
      return aAbB(alpha) + '-' + cuttingNumber[3]
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: 'numberBegin番号所有格式未找到' + originalId })
  }
}

function AaBb(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const s = str[i]
    if (!s) continue
    result += i % 2 === 0 ? s.toUpperCase() : s.toLowerCase()
  }
  return result
}

function aAbB(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const s = str[i]
    if (!s) continue
    result += i % 2 === 0 ? s.toLowerCase() : s.toUpperCase()
  }
  return result
}

function searchVariantOf(originalId: string, type: number): string {
  switch (getSeriesFactory(originalId)) {
    case SeriesFactory.FC2PPV:
      return fc2Ppv(originalId, type)
    case SeriesFactory.ALLDIGIT:
      return allDigit(originalId, type)
    case SeriesFactory.NUMBERBEGIN:
      return numberBegin(originalId, type)
    case SeriesFactory.ALPHANUMBER:
      return alphaNumber(originalId, type)
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: '番号所有格式未找到' + originalId })
  }
}

function javdbVariantOf(originalId: string): string {
  switch (getSeriesFactory(originalId)) {
    case SeriesFactory.ALLDIGIT:
      return allDigit(originalId, 1)
    case SeriesFactory.NUMBERBEGIN:
      return numberBegin(originalId, 0)
    case SeriesFactory.ALPHANUMBER:
      return alphaNumber(originalId, 0)
    default:
      throw new ProjectError({ name: 'GET_PROJECT_ERROR', message: '番号所有格式未找到' + originalId })
  }
}

/** 一个番号的四种写法。纯计算，不会抛错；只有 searchVariant / javdbVariant 会。 */
export function parseSerialNumber(raw: string): SerialNumber {
  const normalized = normalizeFc2(raw.trim())
  return {
    raw,
    identity: identityOf(normalized),
    archiveKey: archiveKeyOf(normalized),
    isFc2: FC2_LOOSE_REG.test(normalized),
    searchVariant: (type: number) => searchVariantOf(normalized, type),
    javdbVariant: () => javdbVariantOf(normalized)
  }
}

/**
 * 从标题 / 链接文本里抽番号，返回**身份**（已归一化）。
 * 抽不到返回 undefined —— 这是「页面上有几条妹妹不认字」的正常结局，不是错误。
 */
export function extractSerialNumber(text: string): string | undefined {
  const fc2 = text.match(TEXT_FC2_REG)
  if (fc2?.[1]) return identityOf('FC2PPV' + fc2[1])

  const match = text.match(TEXT_SERIAL_REG)
  if (match?.[1] && match[2]) return identityOf(normalizeFc2(`${match[1]}-${match[2]}`))

  return undefined
}
