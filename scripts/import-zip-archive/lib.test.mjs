import { describe, expect, it } from 'vitest'
import {
  AUTO_MATCH_SCORE,
  buildSearchKeywords,
  buildSearchUrl,
  classifyCandidate,
  compareTitle,
  decodeEntities,
  getBracketTag,
  isDistinctiveKeyword,
  parseFileName,
  parseSearchPage,
  sanitizeSearchKeyword,
  scoreCandidate,
  sqlText,
  sqlTimestamp,
  toArchiveTitle,
  toWindowsSafeName
} from './lib.mjs'

/** 用例取自 Y:\ehviewer\animated 的真实文件名 */
const MTIME = Date.UTC(2026, 1, 13, 22, 48, 42)

describe('parseFileName', () => {
  it('剥离扩展名与尾部 gid', () => {
    expect(parseFileName('Mix WEBP Part1 [AI Generated] [4008003].zip')).toEqual({
      rawTitle: 'Mix WEBP Part1 [AI Generated]',
      gidHint: 4008003,
      ext: 'zip'
    })
  })

  it('gid 紧贴前一段方括号时也能剥离', () => {
    expect(parseFileName('NewStudioAI - Artoria Pendragon (Lancer) animated [AI Generated][4257837].zip')).toEqual({
      rawTitle: 'NewStudioAI - Artoria Pendragon (Lancer) animated [AI Generated]',
      gidHint: 4257837,
      ext: 'zip'
    })
  })

  it('YYYYMMDD 形态当作标题的一部分', () => {
    expect(parseFileName('[DMM.com] Dot Abyss X ドットアビスX [20260702].zip')).toEqual({
      rawTitle: '[DMM.com] Dot Abyss X ドットアビスX [20260702]',
      ext: 'zip'
    })
  })

  it('保留连续空格与尾部空格', () => {
    const parsed = parseFileName('CunnyFunK  Ai generated  .zip')
    expect(parsed.rawTitle).toBe('CunnyFunK  Ai generated  ')
    expect(parsed.gidHint).toBeUndefined()
  })

  it('不支持的扩展名不剥扩展名', () => {
    expect(parseFileName('くりくりクリック.7z')).toEqual({ rawTitle: 'くりくりクリック.7z', ext: '7z' })
  })
})

describe('标题归一化 / 消毒 / 截断', () => {
  it('toWindowsSafeName 替换非法字符并去尾部空格点', () => {
    expect(toWindowsSafeName('a:b?c*d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h')
    expect(toWindowsSafeName('Title. ')).toBe('Title')
  })

  it('toArchiveTitle 与站点 extractTitle 同口径', () => {
    expect(toArchiveTitle('  abc  ')).toBe('abc')
    expect(toArchiveTitle('x'.repeat(300))).toHaveLength(255)
  })
})

describe('compareTitle', () => {
  it('exact：归一化后全等', () => {
    expect(compareTitle('千夏', '千夏')).toBe('exact')
    expect(compareTitle('ＣｕｎｎｙＦｕｎｋ', 'CunnyFunk')).toBe('exact')
    expect(compareTitle('CunnyFunK  Ai generated', 'CunnyFunK  Ai generated  ')).toBe('exact')
  })

  it('equivalent：消毒后与文件名一致', () => {
    expect(compareTitle('a:b?c', 'a_b_c')).toBe('equivalent')
    expect(compareTitle('Title.', 'Title')).toBe('equivalent')
  })

  it('equivalent：站点标题是无空格驼峰', () => {
    expect(
      compareTitle(
        '[1]Mikitoonzzz0925SaberArtoriaAndOthers [AI Generated]',
        '[1] Mikitoonzzz0925 Saber Artoria And Others [AI Generated]'
      )
    ).toBe('equivalent')
  })

  it('equivalent：文件名是标题短版', () => {
    expect(
      compareTitle('[PATREON] Old Apple WEBP Collection [83272468] [AI Generated]', '[PATREON] Old Apple WEBP Collection')
    ).toBe('equivalent')
  })

  it('短文件名不做前缀匹配', () => {
    expect(compareTitle('Animated Collection For Everyone', 'Animated')).toBe('none')
  })

  it('前缀之外差异过大不判等价', () => {
    expect(compareTitle(`Some Long Title Here ${'x'.repeat(60)}`, 'Some Long Title Here')).toBe('none')
  })
})

describe('搜索词', () => {
  it('去掉站点搜索语法字符，词首减号降级', () => {
    expect(sanitizeSearchKeyword('a "b" ~c $d |e (f) [g]')).toBe('a b c d e f g')
    expect(sanitizeSearchKeyword('NewStudioAI - Artoria Pendragon')).toBe('NewStudioAI Artoria Pendragon')
  })

  it('生成从精确到宽松的候选词', () => {
    expect(buildSearchKeywords('Mix WEBP Part1 [AI Generated]')).toEqual(['Mix WEBP Part1 AI Generated', 'Mix WEBP Part1'])
    const long = buildSearchKeywords('a b c d e f g h i j [AI Generated]')
    expect(long[0]).toBe('a b c d e f g h i j AI Generated')
    expect(long[1]).toBe('a b c d e f g h i j')
    expect(long[2]).toBe('a b c d e f g h')
    expect(long[3]).toBe('a b c d e f')
  })

  it('空标题不产生查询', () => {
    expect(buildSearchKeywords('   ')).toEqual([])
    expect(buildSearchKeywords('[]')).toEqual([])
  })

  it('跨语言标题：去掉所有括号组后只剩核心词', () => {
    const keywords = buildSearchKeywords('(18禁ゲームCG) [Argonauts] 夏への方舟 (Animated WebP Compilation)')
    expect(keywords).toContain('夏への方舟')
    expect(keywords[0]).toBe('18禁ゲームCG Argonauts 夏への方舟 Animated WebP Compilation')
  })

  it('跨语言标题：多段括号也只留核心词', () => {
    const keywords = buildSearchKeywords('(同人CG集) [MだSたろう & Yakin] 胡桃まんぐりっクス [Animated] (原神)')
    expect(keywords).toContain('胡桃まんぐりっクス')
  })

  it('URL 编码', () => {
    expect(buildSearchUrl('千夏 & co')).toBe('https://exhentai.org/?f_search=%E5%8D%83%E5%A4%8F%20%26%20co')
  })
})

describe('isDistinctiveKeyword', () => {
  it('日文/中文词 ≥4 字、英文词 ≥12 字符才算独特', () => {
    expect(isDistinctiveKeyword('胡桃まんぐりっクス')).toBe(true)
    expect(isDistinctiveKeyword('ぺこーらのオシッコで育ったニンジンを食べたい')).toBe(true)
    expect(isDistinctiveKeyword('Animated')).toBe(false)
    expect(isDistinctiveKeyword('Mix WEBP')).toBe(false)
    expect(isDistinctiveKeyword('WutheringWavesCollection')).toBe(true)
  })
})

describe('decodeEntities', () => {
  it('解常见实体与数字实体', () => {
    expect(decodeEntities('A &amp; B &#39;s &quot;C&quot; &#x4E2D;')).toBe("A & B 's \"C\" 中")
    expect(decodeEntities('a&nbsp;b')).toBe('a b')
    expect(decodeEntities('&unknown;')).toBe('&unknown;')
  })
})

/**
 * 结构与仓库快照 src/site/exhentai/html/ExHentai.org.mhtml 一致，
 * 只保留解析相关节点。
 */
const SEARCH_HTML = `<div class="ido"><div class="itg gld">
  <div class="gl1t"><a href="https://exhentai.org/g/4269646/fe5c1ae5c9/"><div class="gl4t glname glink">[Pixiv/fanbox/e621] Dagasi (1549213) (July 2025 - Present)</div></a>
    <div class="gl5t"><div><div class="cs ct6">Image Set</div><div id="posted_4269646">2026-10-20 16:01</div></div></div></div>
  <div class="gl1t"><a href="https://exhentai.org/g/4269582/a9075a672d/"><div class="gl4t glname glink">[aigame78] Realistic Work 05 [AI Generated]</div></a>
    <div class="gl5t"><div><div id="posted_4269582">2026-10-19 23:00</div></div></div></div>
</div></div>`

describe('parseSearchPage', () => {
  it('解析 gid / 标题 / 发布时间', () => {
    const parsed = parseSearchPage(SEARCH_HTML)
    expect(parsed.hasResultBlock).toBe(true)
    expect(parsed.noHits).toBe(false)
    expect(parsed.candidates).toHaveLength(2)
    expect(parsed.candidates[0]).toMatchObject({
      gid: 4269646,
      token: 'fe5c1ae5c9',
      title: '[Pixiv/fanbox/e621] Dagasi (1549213) (July 2025 - Present)',
      postedText: '2026-10-20 16:01'
    })
  })

  it('标题 div 缺失时回退到 img[alt]', () => {
    const html = `<div class="gl1t"><a href="https://exhentai.org/g/1234567/abcdef0123/"><img alt="Fallback &amp; Title"></a></div>`
    expect(parseSearchPage(html).candidates[0]).toMatchObject({ gid: 1234567, title: 'Fallback & Title' })
  })

  it('识别无命中页面', () => {
    const parsed = parseSearchPage('<div class="ido"><p>No hits found</p></div>')
    expect(parsed.noHits).toBe(true)
    expect(parsed.hasResultBlock).toBe(false)
  })

  it('陌生页面既不算命中也不算无命中', () => {
    const parsed = parseSearchPage('<html><body><div class="x"></div></body></html>')
    expect(parsed.noHits).toBe(false)
    expect(parsed.hasResultBlock).toBe(false)
  })
})

describe('getBracketTag', () => {
  it('取首段方括号标签并小写', () => {
    expect(getBracketTag('[Generator Kin] Aemeath [AI Generated]')).toBe('generator kin')
    expect(getBracketTag('没有标签的标题')).toBe('')
  })
})

describe('scoreCandidate / classifyCandidate', () => {
  const file = { rawTitle: '[CunnyFunky] 10-9-2026 iori_(blue_archive)', mtime: MTIME }

  it('gid 提示命中直接 matched', () => {
    const result = classifyCandidate(
      { rawTitle: 'Xyz', gidHint: 4008003, mtime: MTIME },
      [{ gid: 4008003, title: '完全不同的标题', postedText: '' }]
    )
    expect(result.status).toBe('matched')
    expect(result.level).toBe('gid')
  })

  it('exact 命中', () => {
    const result = classifyCandidate(file, [{ gid: 1, title: '[CunnyFunky] 10-9-2026 iori_(blue_archive) ', postedText: '' }])
    expect(result).toMatchObject({ status: 'matched', level: 'exact' })
  })

  it('短版文件名走 equivalent', () => {
    const result = classifyCandidate(
      { rawTitle: '[PATREON] Old Apple WEBP Collection', mtime: MTIME },
      [{ gid: 3769705, title: '[PATREON] Old Apple WEBP Collection [83272468] [AI Generated]', postedText: '' }]
    )
    expect(result).toMatchObject({ status: 'matched', level: 'equivalent' })
  })

  it('同标签同日期的高分候选自动采纳', () => {
    const scored = scoreCandidate(file, {
      gid: 2,
      title: '[CunnyFunky] 10-9-2026 iori blue archive [AI Generated]',
      postedText: '2026-02-14 12:00'
    })
    expect(scored).toBeGreaterThanOrEqual(AUTO_MATCH_SCORE)
    const result = classifyCandidate(file, [
      { gid: 2, title: '[CunnyFunky] 10-9-2026 iori blue archive [AI Generated]', postedText: '2026-02-14 12:00' }
    ])
    expect(result.status).toBe('matched')
    expect(result.level).toBe('score')
  })

  it('独特单词查询只命中 1 条时直接采纳（跨语言标题）', () => {
    const result = classifyCandidate(
      { rawTitle: '(18禁ゲームCG) [Argonauts] 夏への方舟 (Animated WebP Compilation)', mtime: MTIME },
      [{ gid: 9, title: '[Argonauts] Natsu e no Hakobune (Animated WebP Compilation)', postedText: '' }],
      { distinctive: true }
    )
    expect(result).toMatchObject({ status: 'matched', level: 'unique' })
  })

  it('多词查询只命中 1 条时按 sole 采纳', () => {
    const result = classifyCandidate(
      { rawTitle: '(同人CG集) [しろくまメガネ] うごイラ (Animated) (pixiv) (よろず) [AI生成]', mtime: MTIME },
      [
        {
          gid: 4232812,
          title: '[しろくまメガネ] うごイラ (Animated) (pixiv) (よろず) [AI Generated]',
          postedText: ''
        }
      ],
      { distinctive: false, keyword: '同人CG集 しろくまメガネ うごイラ Animated pixiv よろず AI生成' }
    )
    expect(result).toMatchObject({ status: 'matched', level: 'sole' })
  })

  it('独特单词查询命中多条且分数低时进入裁决', () => {
    const result = classifyCandidate(
      { rawTitle: '(同人CG集) [MだSたろう & Yakin] 胡桃まんぐりっクス [Animated] (原神)', mtime: MTIME },
      [
        { gid: 1, title: '[Mda Starou & Yakin] 胡桃まんぐりっクス (Genshin Impact)', postedText: '' },
        { gid: 2, title: '[Other] Something Else', postedText: '' }
      ],
      { distinctive: true }
    )
    expect(result.status).toBe('fuzzy')
    expect(result.options).toHaveLength(2)
  })

  it('通用名且候选不相关时标 skip，并给出候选列表', () => {
    const result = classifyCandidate(
      { rawTitle: 'Animated [AI Generated]', mtime: MTIME },
      [
        { gid: 10, title: '[Someone] Totally Different Work', postedText: '2020-01-01 00:00' },
        { gid: 11, title: '[Other] Another Thing', postedText: '2021-01-01 00:00' }
      ]
    )
    expect(result.status).toBe('skip')
    expect(result.options.length).toBe(2)
    expect(result.options[0].score).toBeGreaterThanOrEqual(result.options[1].score)
  })
})

describe('SQL 字面量', () => {
  it('单引号翻倍', () => {
    expect(sqlText("It's [AI's]")).toBe("'It''s [AI''s]'")
  })

  it('拒绝 NUL', () => {
    expect(() => sqlText('a\u0000b')).toThrow('NUL')
  })

  it('时间戳输出带时区', () => {
    expect(sqlTimestamp(0)).toBe("'1970-01-01T00:00:00.000Z'::timestamptz")
  })
})
