/**
 * 本地 zip 补录 —— 纯函数层（无网络、无文件系统、无第三方依赖）。
 *
 * 为什么独立成脚本而不是复用浏览器端：补录是一次性运维动作，走 `supabase db query` 直连，
 * 不需要挂在用户脚本里；这里的解析/匹配规则必须与站点列表页口径一致，
 * 否则写进去的 title_hash 与线上判定对不上。
 *
 * 匹配口径（按优先级）：
 *   1. 文件名尾部 [gid] 与候选 gid 相同 → 命中（gid 比标题可靠，标题常被改）
 *   2. 标题归一化后全等 → exact
 *   3. 经 Windows 消毒 / 255 截断 / "文件名是标题短版" 前缀规则 → equivalent
 *   4. 其余 → 打分，≥ AUTO_MATCH_SCORE 自动采纳，否则交给人工/AI 裁决
 */

/** 支持的压缩包扩展名（Y:\ehviewer\animated 下还有一个 .7z，不参与补录） */
export const IMPORT_EXTENSIONS = ['zip']

/** 写库标题上限，与 hentai_gallery.title / 站点 extractTitle 一致 */
export const TITLE_MAX_LENGTH = 255

/** 文件系统单个路径组件上限（UTF-16 码元） */
const WINDOWS_NAME_LIMIT = 255

/** `.zip` 占用的 4 个码元 */
const ZIP_SUFFIX_LENGTH = 4

/** 「文件名是标题短版」前缀规则的阈值（太短会大面积误命中） */
const MIN_PREFIX_MATCH_LENGTH = 20
const MAX_PREFIX_MATCH_DELTA = 40

/** 自动裁决阈值：≥ 自动采纳；[DISPUTE_SCORE, AUTO] 交给 AI/人工；< DISPUTE 直接 skip */
export const AUTO_MATCH_SCORE = 0.85
export const DISPUTE_SCORE = 0.55

/** Windows 文件名里不允许出现的可见字符（控制字符按码点过滤） */
const WINDOWS_ILLEGAL_VISIBLE = '<>:"/\\|?*'

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** 取小写扩展名（不含点）；无扩展名返回空串 */
export function getExtension(fileName) {
  const idx = fileName.lastIndexOf('.')
  if (idx <= 0 || idx === fileName.length - 1) return ''
  return fileName.slice(idx + 1).toLowerCase()
}

export function isSupportedFile(fileName) {
  return IMPORT_EXTENSIONS.includes(getExtension(fileName))
}

/** 按 UTF-16 码元截断且不切断代理对（仅用于文件名消毒） */
export function sliceUtf16Safe(text, max) {
  if (max <= 0) return ''
  if (text.length <= max) return text
  let end = max
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/** `[20260702]` 这类 8 位日历数不是 gid，应保留在标题里 */
function looksLikeDateHint(value) {
  if (value.length !== 8) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  return year >= 2000 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * 解析补录文件名：去扩展名、剥离尾部 `[gid]`。
 * 注意：有些画廊把数字写在标题里（如 `[PATREON] Old Apple WEBP Collection [83272468]`），
 * 剥离只是"搜索用"的猜测，最终标题以站点返回为准。
 */
export function parseFileName(fileName) {
  const ext = getExtension(fileName)
  const base = IMPORT_EXTENSIONS.includes(ext) ? fileName.slice(0, fileName.length - ext.length - 1) : fileName
  const matched = base.match(/^(.*?)\s*\[(\d{4,})\]\s*$/)
  if (matched && matched[1] !== undefined && matched[2] !== undefined && !looksLikeDateHint(matched[2])) {
    return { rawTitle: matched[1], gidHint: Number(matched[2]), ext }
  }
  return { rawTitle: base, ext }
}

/** 标题归一化：NFKC + 全角空格归一 + 空白压缩 + trim（仅用于比对） */
export function normalizeTitle(title) {
  return String(title)
    .normalize('NFKC')
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 按 Windows 命名规则消毒标题，用于「站点标题 → 预期文件名」的反向比对 */
export function toWindowsSafeName(name) {
  let out = ''
  for (const char of String(name)) {
    const code = char.codePointAt(0) ?? 0
    out += code < 0x20 || WINDOWS_ILLEGAL_VISIBLE.includes(char) ? '_' : char
  }
  return sliceUtf16Safe(out.replace(/[ .]+$/, ''), WINDOWS_NAME_LIMIT)
}

/** 去掉全部空白并忽略大小写，用于识别"驼峰无空格"标题 */
function compactTitle(text) {
  return normalizeTitle(text).replace(/\s+/g, '').toLowerCase()
}

/** 写库标题：trim + 255 截断，与站点 extractTitle 完全同口径 */
export function toArchiveTitle(title) {
  return String(title).trim().slice(0, TITLE_MAX_LENGTH)
}

/**
 * 比较「站点候选标题」与「文件名（已剥离 gid）」是否指向同一画廊。
 * @returns {'exact'|'equivalent'|'none'}
 */
export function compareTitle(candidateTitle, fileNameBase) {
  const candidate = normalizeTitle(candidateTitle)
  const base = normalizeTitle(fileNameBase)
  if (!candidate || !base) return 'none'
  if (candidate === base) return 'exact'

  const safeCandidate = normalizeTitle(toWindowsSafeName(candidateTitle))
  if (safeCandidate === base) return 'equivalent'

  // 站点标题常用"无空格驼峰"（[1]Mikitoonzzz0925SaberArtoriaAndOthers），
  // 本地文件名按词分开；去掉全部空白并忽略大小写再比一次。
  if (compactTitle(candidate) === compactTitle(base)) return 'equivalent'

  // 文件名上限把标题截断：`.zip` 占 4 个码元，标题部分最多 251
  if (normalizeTitle(toWindowsSafeName(sliceUtf16Safe(candidateTitle, WINDOWS_NAME_LIMIT - ZIP_SUFFIX_LENGTH))) === base) {
    return 'equivalent'
  }
  // 反向：文件名本身就是被截断的形态（长度已贴上限）
  if (base.length >= WINDOWS_NAME_LIMIT - ZIP_SUFFIX_LENGTH - 1 && candidate.startsWith(base)) return 'equivalent'

  // 文件名是标题的短版：站点标题尾部多了标签（如 " [AI Generated]"）
  if (base.length >= MIN_PREFIX_MATCH_LENGTH && candidate.startsWith(base) && candidate.length - base.length <= MAX_PREFIX_MATCH_DELTA) {
    return 'equivalent'
  }

  return 'none'
}

/**
 * 搜索关键词消毒。E-Hentai 的搜索串支持 `"` `~` `$` `|` `-` `()` 语法，
 * 标题里这些字符很常见，直接塞进去会被当成语法解析，统一降级为普通词元。
 */
export function sanitizeSearchKeyword(keyword) {
  return normalizeTitle(keyword)
    .replace(/["~$|()[\]]/g, ' ')
    .replace(/(^|\s)-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim()
}

/** 括号分组（方括号或圆括号），用于从标题里剥离装饰性标签 */
const GROUP_PATTERN = /[[(][^\])]*[\])]/g

/**
 * 为一个文件名生成候选搜索词（从精确到宽松），调用方命中即停。
 *
 * 为什么需要"去掉所有括号组"这一档：站点标题与本地文件名经常不同语言。
 * 实测样例：文件名 `(18禁ゲームCG) [Argonauts] 夏への方舟 (Animated WebP Compilation)`，
 * 站点标题却是 `[Argonauts] Natsu e no Hakobune (Animated WebP Compilation)`——
 * 带日文全名查询会 0 结果，只留核心词（`夏への方舟`）才搜得到，随后由人工/打分裁决。
 */
export function buildSearchKeywords(rawTitle) {
  const text = String(rawTitle)
  const base = sanitizeSearchKeyword(text)
  if (!base) return []

  const variants = [base]

  const withoutTrailing = sanitizeSearchKeyword(text.replace(/(\s*[[(][^\])]*[\])]\s*)+$/g, ' '))
  if (withoutTrailing && withoutTrailing !== base) variants.push(withoutTrailing)

  const withoutLeading = sanitizeSearchKeyword(text.replace(/^\s*[[(][^\])]*[\])]\s*/, ' '))
  if (withoutLeading && withoutLeading !== base) variants.push(withoutLeading)

  // 去掉所有括号组：只留核心标题（跨语言标题唯一还能命中的形态）
  const withoutAll = sanitizeSearchKeyword(text.replace(GROUP_PATTERN, ' '))
  if (withoutAll) variants.push(withoutAll)

  const tokens = (withoutAll || base).split(' ').filter(Boolean)
  if (tokens.length > 8) variants.push(tokens.slice(0, 8).join(' '))
  if (tokens.length > 6) variants.push(tokens.slice(0, 6).join(' '))

  const longest = tokens.reduce((longestToken, token) => (token.length > longestToken.length ? token : longestToken), '')
  if (longest.length >= 6) variants.push(longest)

  return Array.from(new Set(variants.filter(Boolean)))
}

/** 假名 / 汉字：日文标题的唯一标识性字符集 */
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/**
 * 是否是"足够独特的单词查询"。
 *
 * 判定不能只看长度：`Animated` 有 8 个字符但极其通用，命中会是一堆无关画廊。
 * 因此日文/中文词要求 ≥4 字，纯英文单词要 ≥12 字符（基本只可能是专有名词）。
 * 这类查询命中 1 条时几乎必然正确，是跨语言标题（本地日文名 vs 站点罗马音）的主要线索。
 */
export function isDistinctiveKeyword(keyword) {
  const value = String(keyword).trim()
  if (!value || value.includes(' ')) return false
  if (CJK_PATTERN.test(value)) return value.length >= 4
  return value.length >= 12
}

export function buildSearchUrl(keyword) {
  return `https://exhentai.org/?f_search=${encodeURIComponent(keyword)}`
}

/** 解 HTML 实体（`&#39;` / `&amp;` / `&nbsp;` 等），标题里很常见 */
export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity) => {
    const key = String(entity).toLowerCase()
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return HTML_ENTITIES[key] ?? whole
  })
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * 解析搜索页。页面结构（与仓库快照一致）：
 *   div.itg.gld > div.gl1t
 *     a[href="/g/<gid>/<token>/"] > div.gl4t.glname.glink  → 标题
 *     img[alt]                                             → 标题兜底
 *     div.gl5t > div#posted_<gid>                          → 发布时间
 */
export function parseSearchPage(html) {
  const source = String(html)
  const blocks = source.split(/<div class="gl1t"/i).slice(1)
  const noHits = /no hits found|did not return any results|no results found/i.test(stripTags(source))

  const candidates = []
  for (const block of blocks) {
    const ref = block.match(/href="[^"]*?\/g\/(\d+)\/([0-9a-z]+)/i)
    if (!ref) continue
    const gid = Number(ref[1])
    if (!Number.isFinite(gid) || gid <= 0) continue

    let title = ''
    const titleDiv = block.match(/<div class="gl4t glname glink"[^>]*>([\s\S]*?)<\/div>/i)
    if (titleDiv) title = stripTags(titleDiv[1])
    if (!title) {
      const glname = block.match(/<div class="glname"[^>]*>([\s\S]*?)<\/div>/i)
      if (glname) title = stripTags(glname[1])
    }
    if (!title) {
      const alt = block.match(/<img[^>]*\balt="([^"]*)"/i)
      if (alt) title = decodeEntities(alt[1]).trim()
    }
    if (!title) continue

    const postedRaw = block.match(/<div id="posted_\d+"[^>]*>([\s\S]*?)<\/div>/i)
    const postedText = postedRaw ? stripTags(postedRaw[1]) : ''
    candidates.push({ gid, token: ref[2], title, postedText })
  }

  return { candidates, noHits, hasResultBlock: blocks.length > 0 }
}

/**
 * 取标题里第一个方括号分组（社团/画师），例如 `[Generator Kin] xxx` → `generator kin`。
 * 不能只匹配行首：本地文件名常被加上 `(同人CG集)` 这类前缀，画师标签就落到第二段了。
 */
export function getBracketTag(title) {
  const text = normalizeTitle(title)
  const matched = text.match(/\[([^\]]+)\]/) ?? text.match(/\(([^)]+)\)/)
  return matched ? matched[1].toLowerCase().trim() : ''
}

function tokenize(text) {
  return normalizeTitle(text)
    .toLowerCase()
    .split(/[\s()[\]{}_\-.,!?&/\\|:;"'~]+/)
    .filter((token) => token.length > 0)
}

function tokenStats(a, b) {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 || setB.size === 0) return { intersection: 0, union: 0, min: 0 }
  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++
  return { intersection, union: setA.size + setB.size - intersection, min: Math.min(setA.size, setB.size) }
}

/**
 * 标题相似度。
 *
 * 只用 Jaccard 会低估"文件名是标题短版"这一类（文件名少了尾部 `[AI Generated]`，
 * 交集 7/并集 9 只有 0.78，够不到自动采纳线）；只用包含度又会让通用短名霸榜。
 * 因此在文件名 token 数 ≥4 时取两者均值，短名仍只用 Jaccard。
 */
function similarity(a, b) {
  const { intersection, union, min } = tokenStats(a, b)
  if (union === 0 || min === 0) return 0
  const jaccard = intersection / union
  if (min < 4) return jaccard
  return (jaccard + intersection / min) / 2
}

function parsePostedDate(postedText) {
  if (!postedText) return undefined
  const matched = String(postedText).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!matched) return undefined
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4]), Number(matched[5]))
}

/**
 * 候选打分（0..1）。权重按可用信号归一化，避免"没有 gidHint 就永远到不了阈值"。
 *   token Jaccard 0.6 / 首段方括号标签一致 0.2 / gidHint 命中 0.15 / 发布日期接近 mtime 0.05
 */
export function scoreCandidate(file, candidate) {
  const fileTitle = file.rawTitle || ''
  const signals = [
    { weight: 0.6, value: similarity(tokenize(fileTitle), tokenize(candidate.title)) },
    { weight: 0.2, value: getBracketTag(fileTitle) && getBracketTag(fileTitle) === getBracketTag(candidate.title) ? 1 : 0 }
  ]

  if (file.gidHint) {
    signals.push({ weight: 0.15, value: candidate.gid === file.gidHint ? 1 : 0 })
  }

  const posted = parsePostedDate(candidate.postedText)
  if (posted) {
    const days = Math.abs(posted - file.mtime) / 86400000
    signals.push({ weight: 0.05, value: days <= 7 ? 1 : days <= 45 ? 0.5 : 0 })
  }

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  const weighted = signals.reduce((sum, signal) => sum + signal.weight * signal.value, 0)
  return totalWeight === 0 ? 0 : weighted / totalWeight
}

/**
 * 候选裁决：硬规则优先（gid / exact / equivalent），其次按分数，最后用"独特单词查询"兜底。
 *
 * context.distinctive = 当前命中来自一个不含空格、长度 ≥6 的查询。
 * 这类查询命中 1 条时几乎必然正确（跨语言标题也适用），直接采纳；
 * 命中 ≤5 条时进入人工/AI 裁决；命中更多说明这个词太泛，跳过。
 *
 * @returns {{status:'matched'|'fuzzy'|'skip', level:string, candidate?:object, score:number, options:object[]}}
 */
export function classifyCandidate(file, candidates, context = {}) {
  const options = candidates.map((candidate) => ({
    gid: candidate.gid,
    title: toArchiveTitle(candidate.title),
    postedText: candidate.postedText,
    score: Number(scoreCandidate(file, candidate).toFixed(3))
  }))

  if (file.gidHint) {
    const byGid = candidates.find((candidate) => candidate.gid === file.gidHint)
    if (byGid) {
      return { status: 'matched', level: 'gid', candidate: byGid, score: 1, options: [] }
    }
  }

  const exact = candidates.find((candidate) => compareTitle(candidate.title, file.rawTitle) === 'exact')
  const equivalent =
    exact ??
    candidates.find((candidate) => compareTitle(candidate.title, file.rawTitle) === 'equivalent')
  if (equivalent) {
    return {
      status: 'matched',
      level: exact ? 'exact' : 'equivalent',
      candidate: equivalent,
      score: Number(scoreCandidate(file, equivalent).toFixed(3)),
      options: []
    }
  }

  const ranked = [...options].sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) return { status: 'fuzzy', level: 'none', score: 0, options: [] }

  const bestCandidate = candidates.find((candidate) => candidate.gid === best.gid)
  const distinctive = context.distinctive === true
  const tokenCount = String(context.keyword ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  // 独特单词查询只命中 1 条：几乎不可能是巧合（跨语言标题也只能靠这条路）
  if (distinctive && candidates.length === 1) {
    return { status: 'matched', level: 'unique', candidate: bestCandidate, score: best.score, options: [] }
  }
  // 多词查询（≥3 个词元）只命中 1 条：站点搜索是"全部词元都要命中"，
  // 唯一结果基本就是目标画廊（本地标题多了 (同人CG集)、少写 [AI Generated] 也不影响）
  if (tokenCount >= 3 && candidates.length === 1) {
    return { status: 'matched', level: 'sole', candidate: bestCandidate, score: best.score, options: [] }
  }
  if (best.score >= AUTO_MATCH_SCORE) {
    return { status: 'matched', level: 'score', candidate: bestCandidate, score: best.score, options: [] }
  }
  if (best.score >= DISPUTE_SCORE || (distinctive && candidates.length <= 5)) {
    return { status: 'fuzzy', level: 'none', score: best.score, options: ranked.slice(0, 5) }
  }
  return { status: 'skip', level: 'none', score: best.score, options: ranked.slice(0, 5) }
}

/** SQL 字符串字面量（单引号翻倍），并拒绝 NUL */
export function sqlText(value) {
  const text = String(value)
  if (text.includes('\u0000')) throw new Error('SQL 字面量包含 NUL 字符')
  return `'${text.replace(/'/g, "''")}'`
}

/** SQL timestamptz 字面量 */
export function sqlTimestamp(ms) {
  return `'${new Date(ms).toISOString()}'::timestamptz`
}
