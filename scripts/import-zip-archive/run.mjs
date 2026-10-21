#!/usr/bin/env node
/**
 * 本地 zip → hentai_archive 补录（脚本化，可跨 agent 接力）。
 * 操作手册（交接协议、匹配分级、写库契约、故障处置）：同目录 AGENTS.md。
 *
 * 子命令：
 *   scan      扫描目录，产出 state/files.json
 *   verify    逐条访问 exhentai 搜索校验真实标题（结果逐条追加到 state/verified.jsonl）
 *   report    产出 report.md/json 与 disputed.json（待裁决清单）
 *   status    交接摘要：进度、待裁决、已构建/已执行批次、运行锁（换 agent 先跑这个）
 *   inspect   查看单条校验结果与候选
 *   decide    记录人工/AI 裁决（追加到 state/decisions.jsonl）
 *   build     合并 verify + decide，查重后生成分批 SQL 与 rollback.sql
 *   apply     用 supabase CLI 执行 SQL（必须 --yes；已执行批次会跳过，可随时中断续跑）
 *   verify-db 打印该用户的事件/标记数量
 *
 * 状态为什么用追加式 JSONL：
 *   1. 每条结果落盘一次，Ctrl+C / 断电最多丢"正在请求的那一条"；
 *   2. append-only 便于 git 共享（增量 diff 小、不产生整文件冲突），多个 agent 接力只需同步 state/；
 *   3. 同名记录后写覆盖先写（fold），改规则后重跑某几条不会破坏历史。
 *
 * 写入绕过 RPC，因此 SQL 里自己复刻 sha256(title) 派生、gallery/event upsert 语义。
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
  writeFileSync,
  copyFileSync
} from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildSearchKeywords,
  classifyCandidate,
  isDistinctiveKeyword,
  isSupportedFile,
  parseFileName,
  sqlText,
  sqlTimestamp,
  toArchiveTitle
} from './lib.mjs'
import { SearchError, loadCookie, searchWithRetry, sleep } from './search.mjs'
import { fetchExistingHashes, fetchImportStats, runSqlFile } from './db.mjs'

const SCRIPT_DIR = import.meta.dirname
/** 默认状态目录：放在仓库内，任何 agent 在同一工作区都能找到；同步该目录即可跨机器接力 */
const STATE_DIR = join(SCRIPT_DIR, 'state')
/** 旧版状态目录（仅用于一次性迁移） */
const LEGACY_DIR = join(process.env.TEMP ?? '/tmp', 'mansion-import')

const DEFAULTS = {
  dir: 'Y:\\ehviewer\\animated',
  out: STATE_DIR,
  cookie: join(process.env.TEMP ?? '/tmp', 'exhentai-cookies.txt'),
  interval: 2000,
  retry: 1,
  batchSize: 200,
  uid: '608bc996-7b53-4eb7-8068-201556307a96'
}

// ---------------------------------------------------------------- 参数与文件工具

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson(file, data) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function filePaths(outDir) {
  return {
    files: join(outDir, 'files.json'),
    verified: join(outDir, 'verified.jsonl'),
    decisions: join(outDir, 'decisions.jsonl'),
    applied: join(outDir, 'apply.jsonl'),
    lock: join(outDir, 'run.lock'),
    applyLock: join(outDir, 'apply.lock'),
    reportJson: join(outDir, 'report.json'),
    reportMd: join(outDir, 'report.md'),
    disputed: join(outDir, 'disputed.json'),
    sqlDir: join(outDir, 'sql'),
    manifest: join(outDir, 'sql', 'manifest.json')
  }
}

/** 追加一行并 fsync：中断/断电最多丢当前正在处理的那一条 */
function appendJsonl(file, record) {
  ensureDir(resolve(file, '..'))
  const fd = openSync(file, 'a')
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
}

/** 同名记录后写覆盖先写（append-only 日志的读取口径） */
function foldByFile(records) {
  const map = new Map()
  for (const record of records) {
    if (record?.fileName) map.set(record.fileName, record)
  }
  return map
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ---------------------------------------------------------------- 状态迁移

/**
 * 把旧版（%TEMP%\mansion-import\cache.json + 脚本目录 overrides.json）一次性并入 state/。
 * 只在对应日志文件不存在时执行，避免重复导入。
 */
function migrateLegacyState(paths, outDir) {
  ensureDir(outDir)
  const notes = []

  if (!existsSync(paths.verified) && existsSync(join(LEGACY_DIR, 'cache.json'))) {
    const cache = loadJson(join(LEGACY_DIR, 'cache.json'), { items: {} })
    const items = cache.items ?? {}
    for (const [fileName, item] of Object.entries(items)) {
      appendJsonl(paths.verified, { fileName, ...item, migratedFrom: 'cache.json' })
    }
    notes.push(`已从旧 cache.json 迁移 ${Object.keys(items).length} 条校验结果`)
  }

  if (!existsSync(paths.files) && existsSync(join(LEGACY_DIR, 'files.json'))) {
    copyFileSync(join(LEGACY_DIR, 'files.json'), paths.files)
    notes.push('已迁移 files.json')
  }

  if (!existsSync(paths.decisions)) {
    const legacyOverrides = join(SCRIPT_DIR, 'overrides.json')
    if (existsSync(legacyOverrides)) {
      const overrides = loadJson(legacyOverrides, {})
      let count = 0
      for (const [fileName, decision] of Object.entries(overrides)) {
        appendJsonl(paths.decisions, { fileName, ...decision, migratedFrom: 'overrides.json' })
        count++
      }
      if (count > 0) notes.push(`已从 overrides.json 迁移 ${count} 条裁决`)
    }
  }

  if (notes.length > 0) console.log(`[迁移] ${notes.join('；')}`)
}

// ---------------------------------------------------------------- 运行锁

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 同一状态目录同时只允许一个同类写进程。
 *
 * verify 与 apply 用**两把不同的锁**：verify 只追加本地日志，apply 只走 CLI 写库，
 * 互不干扰；共用一把锁会让「边校验边提交已匹配部分」直接互相阻塞。
 * 锁里带 host + pid：本机进程可用 kill(0) 判活；跨机器接力靠手动删除或 30 分钟超时。
 */
function acquireLock(paths, command, outDir, lockFile = paths.lock) {
  ensureDir(outDir)
  if (existsSync(lockFile)) {
    const lock = loadJson(lockFile, undefined)
    const startedAt = lock?.startedAt ? Date.parse(lock.startedAt) : 0
    const fresh = Date.now() - startedAt < 30 * 60 * 1000
    const alive = lock?.host === hostname() && lock?.pid && processAlive(lock.pid)
    if (fresh && alive) {
      throw new Error(
        `已有进程在跑（pid ${lock.pid}，${lock.command}，开始于 ${lock.startedAt}）。\n` + `确认已死可删除：${lockFile}`
      )
    }
    console.warn(`[锁] 发现过期/异机锁（${lock?.host ?? '?'} pid ${lock?.pid ?? '?'}），接管`)
  }
  writeFileSync(
    lockFile,
    `${JSON.stringify({ pid: process.pid, host: hostname(), command, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  )

  const release = () => {
    try {
      const lock = loadJson(lockFile, undefined)
      if (lock?.pid === process.pid && lock?.host === hostname()) unlinkSync(lockFile)
    } catch {
      // 忽略
    }
  }
  process.on('exit', release)
  return release
}

/** Ctrl+C / kill：只置标志，让循环在两条之间干净退出（当前请求那一条可能丢失，重跑即可） */
let stopping = false
function installStopHandlers() {
  const handler = (signal) => {
    if (stopping) process.exit(130)
    stopping = true
    console.error(`\n[${signal}] 收到中断，当前条目结束后退出（已完成的都已落盘）…`)
  }
  process.on('SIGINT', () => handler('SIGINT'))
  process.on('SIGTERM', () => handler('SIGTERM'))
}

// ---------------------------------------------------------------- scan

function scan(args) {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  const paths = filePaths(outDir)
  const dir = args.dir ?? DEFAULTS.dir
  if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`)

  const files = []
  let skipped = 0
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (!isSupportedFile(name)) {
      skipped++
      continue
    }
    const parsed = parseFileName(name)
    files.push({ fileName: name, mtime: Math.round(stat.mtimeMs), rawTitle: parsed.rawTitle, gidHint: parsed.gidHint })
  }
  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  saveJson(paths.files, { version: 1, dir, scannedAt: new Date().toISOString(), files })
  console.log(`扫描完成：${files.length} 个 zip（跳过 ${skipped} 个非 zip）→ ${paths.files}`)
}

// ---------------------------------------------------------------- verify

async function verify(args) {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  const paths = filePaths(outDir)

  const scanned = loadJson(paths.files, undefined)
  if (!scanned) throw new Error(`缺少 ${paths.files}，先运行 scan`)

  const verified = foldByFile(readJsonl(paths.verified))
  const cookie = loadCookie(args.cookie ?? DEFAULTS.cookie)
  const interval = Number(args.interval ?? DEFAULTS.interval)
  const retry = Number(args.retry ?? DEFAULTS.retry)
  const limit = args.limit ? Number(args.limit) : Infinity
  const only = args.file
  const force = Boolean(args.force)

  const pending = scanned.files.filter((file) => {
    if (only && !file.fileName.includes(only)) return false
    if (force) return true
    const item = verified.get(file.fileName)
    return !item || item.status === 'error'
  })
  const work = pending.slice(0, Number.isFinite(limit) ? limit : pending.length)

  const release = acquireLock(paths, 'verify', outDir)
  installStopHandlers()
  console.log(`待校验 ${pending.length} 条，本次处理 ${work.length} 条（间隔 ${interval}ms）`)

  let lastRequest = 0
  async function paced(fn) {
    const wait = interval - (Date.now() - lastRequest)
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    return fn()
  }

  let done = 0
  let consecutiveFailures = 0
  const stats = { matched: 0, fuzzy: 0, skip: 0, notFound: 0, error: 0 }
  let index = 0
  let banWaits = 0
  try {
    while (index < work.length) {
      if (stopping) break
      const file = work[index]
      let outcome
      let bestSkip
      let hadError = false
      let fatal

      for (const keyword of buildSearchKeywords(file.rawTitle)) {
        if (stopping) break
        try {
          const { candidates } = await paced(() => searchWithRetry(keyword, { cookie, retry }))
          consecutiveFailures = 0
          if (candidates.length === 0) continue
          const result = classifyCandidate(file, candidates, {
            distinctive: isDistinctiveKeyword(keyword),
            keyword
          })
          // 只有"有结论"（matched/fuzzy）才停止；skip 说明这个词太泛或候选不相关，
          // 继续换更精确的短查询（跨语言标题全靠后面的核心词变体命中）
          if (result.status !== 'skip') {
            outcome = { keyword, ...result }
            break
          }
          if (!bestSkip || result.score > bestSkip.score) bestSkip = { keyword, ...result }
        } catch (err) {
          if (err instanceof SearchError && (err.kind === 'rate-limited' || err.kind === 'auth')) {
            fatal = err
            break
          }
          hadError = true
          consecutiveFailures++
          console.warn(`  搜索失败：${file.fileName} / ${keyword}：${err.message}`)
          if (consecutiveFailures >= 5) {
            stopping = true
            break
          }
        }
      }

      if (fatal) {
        // 站点明确给出封禁时长时，可以原地等待后重试同一条（--wait-ban）
        if (args['wait-ban'] && fatal.kind === 'rate-limited' && banWaits < 5) {
          banWaits++
          const wait = Math.max(fatal.waitMs ?? 0, 60_000) + 15_000
          console.warn(`\n[限流] ${fatal.message}；等待 ${Math.ceil(wait / 1000)}s 后重试同一条（第 ${banWaits} 次）…`)
          await sleep(wait)
          consecutiveFailures = 0
          continue
        }
        console.error(`\n已停止：${fatal.message}（进度已保存，稍后重跑 verify 继续）`)
        break
      }

      // 所有变体都只是"证据不足"时，保留其中得分最高的那条，用于报告里追溯
      outcome ??= bestSkip

      // 本次请求全失败时不覆盖已有结论：--force 复验撞上限流，会把原本的 matched 冲成 error
      const previous = verified.get(file.fileName)
      if (!outcome && hadError && previous && previous.status !== 'error') {
        console.warn(`  本次请求失败，保留原有结论（${previous.status}）：${file.fileName}`)
        index++
        continue
      }

      const record = outcome
        ? {
            fileName: file.fileName,
            status: outcome.status,
            level: outcome.level,
            keyword: outcome.keyword,
            gid: outcome.candidate?.gid,
            title: outcome.candidate ? toArchiveTitle(outcome.candidate.title) : undefined,
            score: outcome.score,
            options: outcome.options ?? [],
            checkedAt: new Date().toISOString()
          }
        : {
            fileName: file.fileName,
            status: hadError ? 'error' : 'notFound',
            level: 'none',
            score: 0,
            options: [],
            checkedAt: new Date().toISOString()
          }

      // 逐条落盘：中断时最多丢"正在请求的这条"
      appendJsonl(paths.verified, record)
      verified.set(file.fileName, record)
      stats[record.status] = (stats[record.status] ?? 0) + 1

      done++
      index++
      if (done % 20 === 0) {
        console.log(
          `  进度 ${done}/${work.length}  matched=${stats.matched} fuzzy=${stats.fuzzy} skip=${stats.skip} notFound=${stats.notFound} error=${stats.error}`
        )
      }
      if (consecutiveFailures >= 5) {
        console.warn('连续失败过多，已停止（进度已保存）')
        break
      }
    }
  } finally {
    release()
  }

  const total = countStatuses(verified)
  console.log(
    `本轮完成 ${done} 条${stopping ? '（已中断）' : ''}；累计 matched=${total.matched} fuzzy=${total.fuzzy} skip=${total.skip} notFound=${total.notFound} error=${total.error}`
  )
  console.log(`进度文件：${paths.verified}`)
}

function countStatuses(verified) {
  const stats = { matched: 0, fuzzy: 0, skip: 0, notFound: 0, error: 0 }
  for (const item of verified.values()) {
    if (item.status in stats) stats[item.status]++
    else stats.error++
  }
  return stats
}

// ---------------------------------------------------------------- decisions

function decide(args) {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  const paths = filePaths(outDir)

  const scanned = loadJson(paths.files, { files: [] })
  const fileName = args.file
  if (!fileName) throw new Error('用法：decide --file "<文件名>" (--gid 123 [--title "..."] | --skip) [--reason "..."]')

  const file = scanned.files.find((item) => item.fileName === fileName)
  if (!file) {
    const candidates = scanned.files.filter((item) => item.fileName.includes(fileName)).slice(0, 5)
    throw new Error(`files.json 里没有该文件；相近的有：\n${candidates.map((item) => `  ${item.fileName}`).join('\n') || '（无）'}`)
  }

  const verified = foldByFile(readJsonl(paths.verified)).get(fileName)
  if (args.skip) {
    appendJsonl(paths.decisions, {
      fileName,
      skip: true,
      reason: args.reason ?? '人工标记跳过',
      decidedAt: new Date().toISOString()
    })
    console.log(`已记录跳过：${fileName}`)
    return
  }

  const gid = Number(args.gid)
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('--gid 必须是正整数')

  const options = verified?.options ?? []
  const option = options.find((item) => item.gid === gid)
  const title = toArchiveTitle(args.title ?? option?.title ?? '')
  if (!title) {
    throw new Error(`gid ${gid} 不在候选里，且未提供 --title。候选：\n${options.map((item) => `  ${item.gid} ${item.title}`).join('\n') || '（无）'}`)
  }

  appendJsonl(paths.decisions, {
    fileName,
    gid,
    title,
    reason: args.reason ?? (option ? '候选确认' : '指定 gid 与标题'),
    decidedAt: new Date().toISOString()
  })
  console.log(`已记录裁决：${fileName} → gid ${gid} ${title}`)
}

// ---------------------------------------------------------------- status

function status(args) {
  const outDir = args.out ?? DEFAULTS.out
  const paths = filePaths(outDir)
  const scanned = loadJson(paths.files, undefined)
  const verified = foldByFile(readJsonl(paths.verified))
  const decisions = foldByFile(readJsonl(paths.decisions))
  const applied = readJsonl(paths.applied)
  const manifest = loadJson(paths.manifest, undefined)
  const lock = loadJson(paths.lock, undefined)
  const stats = countStatuses(verified)

  const unresolved = [...verified.values()].filter(
    (item) => item.status === 'fuzzy' && !decisions.has(item.fileName)
  ).length

  const appliedKeys = new Set(applied.map((item) => `${item.batchId}:${item.file}`))
  const pendingBatches = manifest
    ? manifest.batches.filter((batch) => !appliedKeys.has(`${manifest.batchId}:${batch.file}`)).length
    : 0

  const lastVerified = [...verified.values()]
    .map((item) => item.checkedAt)
    .filter(Boolean)
    .sort()
    .pop()

  console.log(
    JSON.stringify(
      {
        stateDir: resolve(outDir),
        files: scanned?.files?.length ?? 0,
        verified: verified.size,
        pending: Math.max(0, (scanned?.files?.length ?? 0) - verified.size),
        stats,
        decisions: decisions.size,
        unresolvedFuzzy: unresolved,
        build: manifest
          ? { batchId: manifest.batchId, batches: manifest.batches.length, totalWrite: manifest.totalWrite, applied: manifest.batches.length - pendingBatches, pending: pendingBatches }
          : null,
        lastVerifiedAt: lastVerified ?? null,
        lock: lock ?? null,
        next:
          unresolved > 0
            ? '先用 decide 处理待裁决项，再 build'
            : (scanned?.files?.length ?? 0) > verified.size
              ? 'node scripts/import-zip-archive/run.mjs verify --limit 200'
              : 'node scripts/import-zip-archive/run.mjs build'
      },
      null,
      2
    )
  )
}

// ---------------------------------------------------------------- report

function report(args) {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  const paths = filePaths(outDir)
  const scanned = loadJson(paths.files, undefined)
  if (!scanned) throw new Error('缺少 files.json，先运行 scan')

  const verified = foldByFile(readJsonl(paths.verified))
  const decisions = foldByFile(readJsonl(paths.decisions))
  const stats = countStatuses(verified)
  const pending = scanned.files.filter((file) => !verified.has(file.fileName)).length

  const disputed = scanned.files
    .map((file) => ({ file, result: verified.get(file.fileName) }))
    // skip 也进清单：它只是"不自动写库"的判定，仍可能包含候选正确的条目（跨语言/画师名标点差异）
    .filter(({ result }) => result && ['fuzzy', 'notFound', 'skip'].includes(result.status))
    .map(({ file, result }) => ({
      fileName: file.fileName,
      rawTitle: file.rawTitle,
      gidHint: file.gidHint,
      mtime: file.mtime,
      status: result.status,
      score: result.score,
      decided: decisions.has(file.fileName),
      options: result.options ?? []
    }))

  const lines = [
    '# 补录校验报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 文件总数：${scanned.files.length}`,
    `- 已校验：${verified.size}（未校验 ${pending}）`,
    `- 可直接写入：${stats.matched}`,
    `- 待裁决：${stats.fuzzy}（其中未裁决 ${disputed.filter((item) => item.status === 'fuzzy' && !item.decided).length}）`,
    `- 自动跳过：${stats.skip}`,
    `- 未找到：${stats.notFound}`,
    `- 出错：${stats.error}`,
    `- 已记录裁决：${decisions.size}`,
    '',
    '## 待裁决清单（fuzzy / notFound）',
    '',
    '| 文件名 | 状态 | 分数 | 已裁决 | 候选 |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const item of disputed) {
    const options = item.options
      .slice(0, 3)
      .map((option) => `${option.gid}: ${option.title} (${option.score})`)
      .join('<br>')
    lines.push(
      `| ${item.fileName.replace(/\|/g, '\\|')} | ${item.status} | ${item.score ?? '-'} | ${item.decided ? '是' : ''} | ${options || '-'} |`
    )
  }

  saveJson(paths.reportJson, { stats, pending, decisions: decisions.size, disputed })
  saveJson(paths.disputed, disputed)
  writeFileSync(paths.reportMd, `${lines.join('\n')}\n`, 'utf8')

  console.log(JSON.stringify({ stats, pending, decisions: decisions.size, disputed: disputed.length }, null, 2))
  console.log(`报告：${paths.reportMd}`)
  console.log(`待裁决：${paths.disputed}`)
}

// ---------------------------------------------------------------- inspect

function inspect(args) {
  const outDir = args.out ?? DEFAULTS.out
  const paths = filePaths(outDir)
  const verified = foldByFile(readJsonl(paths.verified))
  const decisions = foldByFile(readJsonl(paths.decisions))
  const target = args.file
  if (!target) throw new Error('用法：inspect --file "<文件名或子串>"')

  const scanned = loadJson(paths.files, { files: [] })
  const matched = scanned.files.filter((file) => file.fileName.includes(target)).slice(0, 10)
  console.log(
    JSON.stringify(
      matched.map((file) => ({
        ...file,
        result: verified.get(file.fileName),
        decision: decisions.get(file.fileName)
      })),
      null,
      2
    )
  )
}

// ---------------------------------------------------------------- build

function resolveEntries(scanned, verified, decisions, options) {
  const entries = []
  const excluded = []

  for (const file of scanned.files) {
    const decision = decisions.get(file.fileName)
    if (decision?.skip) {
      excluded.push({ fileName: file.fileName, reason: decision.reason ?? 'decide: skip' })
      continue
    }
    if (decision?.gid) {
      const title = toArchiveTitle(decision.title ?? '')
      if (!title) {
        excluded.push({ fileName: file.fileName, reason: 'decision: 指定了 gid 但没有 title' })
        continue
      }
      entries.push({ fileName: file.fileName, mtime: file.mtime, gid: Number(decision.gid), title, source: 'decision' })
      continue
    }

    const result = verified.get(file.fileName)
    if (!result) {
      excluded.push({ fileName: file.fileName, reason: '尚未校验' })
      continue
    }
    if (result.status === 'matched' && result.title) {
      entries.push({
        fileName: file.fileName,
        mtime: file.mtime,
        gid: Number(result.gid ?? 0),
        title: toArchiveTitle(result.title),
        source: result.level ?? 'matched'
      })
      continue
    }
    if (result.status === 'fuzzy' && options.includeFuzzy) {
      entries.push({
        fileName: file.fileName,
        mtime: file.mtime,
        gid: Number(result.gid ?? 0),
        title: toArchiveTitle(result.title),
        source: 'fuzzy'
      })
      continue
    }
    excluded.push({ fileName: file.fileName, reason: `${result.status}${result.score ? ` (${result.score})` : ''}` })
  }

  return { entries, excluded }
}

/** 同一 title_hash 多文件只写一次，水位线取最早 mtime（宁可偏低也不抬高） */
function dedupeByHash(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const hash = sha256(entry.title)
    const group = groups.get(hash)
    if (!group) {
      groups.set(hash, { hash, title: entry.title, gid: entry.gid, mtime: entry.mtime, fileName: entry.fileName, merged: [] })
      continue
    }
    group.merged.push(entry.fileName)
    if (entry.mtime < group.mtime) {
      group.mtime = entry.mtime
      group.fileName = entry.fileName
    }
    if (!group.gid && entry.gid) group.gid = entry.gid
  }
  return Array.from(groups.values())
}

function buildGallerySql(rows) {
  const values = rows.map((row) => `(${sqlText(row.title)}, ${Number(row.gid) || 0}::bigint)`).join(',\n    ')
  return `insert into public.hentai_gallery as gal (title, title_hash, gid)
select v.title, encode(sha256(convert_to(v.title, 'UTF8')), 'hex'), v.gid
from (values
    ${values}
) as v(title, gid)
on conflict on constraint hentai_gallery_title_hash_unique do update
  set gid = case when excluded.gid > 0 then excluded.gid else gal.gid end,
      updated_time = now();`
}

function buildEventSql(rows, uid) {
  const values = rows.map((row) => `(${sqlText(row.title)}, ${sqlTimestamp(row.mtime)})`).join(',\n    ')
  return `insert into public.hentai_archive_event (user_id, gallery_id, status, watermark_date)
select ${sqlText(uid)}::uuid, g.id, 200, v.mtime
from (values
    ${values}
) as v(title, mtime)
join public.hentai_gallery g on g.title_hash = encode(sha256(convert_to(v.title, 'UTF8')), 'hex')
on conflict on constraint hentai_archive_event_user_id_gallery_id_status_unique do update
  set watermark_date = excluded.watermark_date,
      updated_time = now();`
}

function buildLogSql(rows, uid, batchId) {
  const values = rows
    .map(
      (row) =>
        `(${sqlText(row.hash)}, ${sqlText(row.title)}, ${sqlText(row.fileName)}, ${sqlTimestamp(row.mtime)}, ${Number(row.gid) || 0}::bigint)`
    )
    .join(',\n    ')
  return `insert into public.hentai_import_log (user_id, title_hash, title, file_name, file_mtime, gid, status, batch_id)
select ${sqlText(uid)}::uuid, v.title_hash, v.title, v.file_name, v.file_mtime, v.gid, 200, ${sqlText(batchId)}::uuid
from (values
    ${values}
) as v(title_hash, title, file_name, file_mtime, gid)
on conflict on constraint hentai_import_log_user_id_title_hash_unique do update
  set title = excluded.title,
      file_name = excluded.file_name,
      file_mtime = excluded.file_mtime,
      gid = excluded.gid,
      status = excluded.status,
      batch_id = excluded.batch_id,
      imported_time = now();`
}

function buildAssertSql(uid, batchId, expected) {
  return `do $$
declare
  v_log int;
  v_event int;
begin
  if not exists (select 1 from auth.users where id = ${sqlText(uid)}::uuid) then
    raise exception '目标用户不存在：%', ${sqlText(uid)};
  end if;

  select count(*) into v_log
  from public.hentai_import_log
  where batch_id = ${sqlText(batchId)}::uuid;

  select count(*) into v_event
  from public.hentai_import_log l
  join public.hentai_gallery g on g.title_hash = l.title_hash
  join public.hentai_archive_event e
    on e.gallery_id = g.id and e.user_id = l.user_id and e.status = 200
  where l.batch_id = ${sqlText(batchId)}::uuid;

  if v_log <> ${expected} then
    raise exception '补录标记数量不符：实际 % / 期望 %', v_log, ${expected};
  end if;
  if v_event <> ${expected} then
    raise exception '归档事件数量不符：实际 % / 期望 %', v_event, ${expected};
  end if;
end $$;`
}

function build(args) {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  const paths = filePaths(outDir)

  const scanned = loadJson(paths.files, undefined)
  if (!scanned) throw new Error('缺少 files.json，先运行 scan')

  const verified = foldByFile(readJsonl(paths.verified))
  const decisions = foldByFile(readJsonl(paths.decisions))
  const uid = args.uid ?? DEFAULTS.uid
  const batchSize = Number(args.batchSize ?? DEFAULTS.batchSize)

  const { entries, excluded } = resolveEntries(scanned, verified, decisions, {
    includeFuzzy: Boolean(args['include-fuzzy'])
  })
  const deduped = dedupeByHash(entries)

  let existing = new Set()
  if (!args['no-check-db']) {
    existing = fetchExistingHashes(deduped.map((row) => row.hash), { uid, tmpDir: join(outDir, 'tmp') })
  }
  const toWrite = args.overwrite ? deduped : deduped.filter((row) => !existing.has(row.hash))
  const skippedExisting = args.overwrite ? [] : deduped.filter((row) => existing.has(row.hash))

  const sqlDir = ensureDir(paths.sqlDir)
  // 清掉上一次的批次 SQL：避免旧文件残留被误当成本次待执行文件。
  // rollback-<batchId>.sql 按批次命名并保留，已执行的批次仍可回滚。
  for (const name of readdirSync(sqlDir)) {
    if (/^batch-\d+\.sql$/.test(name)) unlinkSync(join(sqlDir, name))
  }
  const batchId = randomUUID()
  const batches = []
  let expected = 0
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const rows = toWrite.slice(i, i + batchSize)
    expected += rows.length
    const file = join(sqlDir, `batch-${String(batches.length + 1).padStart(4, '0')}.sql`)
    const sql = [
      '-- 由 scripts/import-zip-archive 生成：单个事务，失败整体回滚',
      'begin;',
      '',
      buildGallerySql(rows),
      '',
      buildEventSql(rows, uid),
      '',
      buildLogSql(rows, uid, batchId),
      '',
      buildAssertSql(uid, batchId, expected),
      '',
      'commit;',
      ''
    ].join('\n')
    writeFileSync(file, sql, 'utf8')
    batches.push({ file, count: rows.length, expected, fileNames: rows.map((row) => row.fileName) })
  }

  const rollbackFile = join(sqlDir, `rollback-${batchId}.sql`)
  const hashes = toWrite.map((row) => `${sqlText(row.hash)}::text`).join(',\n  ')
  if (toWrite.length > 0) writeFileSync(
    rollbackFile,
    [
      '-- 回滚本批次：删除补录标记与归档事件；画廊行保留（共享目录，删画廊会级联影响其它用户）',
      'begin;',
      '',
      `delete from public.hentai_import_log where batch_id = ${sqlText(batchId)}::uuid;`,
      '',
      'delete from public.hentai_archive_event e',
      'using public.hentai_gallery g',
      'where e.gallery_id = g.id',
      `  and e.user_id = ${sqlText(uid)}::uuid`,
      '  and e.status = 200',
      `  and g.title_hash in (\n  ${hashes || 'null'}\n);`,
      '',
      'commit;',
      ''
    ].join('\n'),
    'utf8'
  )

  saveJson(paths.manifest, {
    version: 1,
    createdAt: new Date().toISOString(),
    uid,
    batchId,
    batchSize,
    rollbackFile,
    totalWrite: toWrite.length,
    skippedExisting: skippedExisting.map((row) => ({ fileName: row.fileName, title: row.title })),
    excluded,
    batches
  })

  console.log(
    JSON.stringify(
      {
        entries: entries.length,
        deduped: deduped.length,
        write: toWrite.length,
        skippedExisting: skippedExisting.length,
        excluded: excluded.length,
        batches: batches.length,
        batchId,
        sqlDir
      },
      null,
      2
    )
  )
  if (toWrite.length > 0 && skippedExisting.length > 0) {
    console.log(`注意：${skippedExisting.length} 条库内已有归档，已跳过（加 --overwrite 可强制覆盖）`)
  }
}

// ---------------------------------------------------------------- apply

function apply(args) {
  const outDir = args.out ?? DEFAULTS.out
  const paths = filePaths(outDir)
  const manifest = loadJson(paths.manifest, undefined)
  if (!manifest) throw new Error('缺少 sql/manifest.json，先运行 build')

  const applied = readJsonl(paths.applied)
  const appliedKeys = new Set(applied.map((item) => `${item.batchId}:${item.file}`))
  const pending = manifest.batches.filter((batch) => !appliedKeys.has(`${manifest.batchId}:${batch.file}`))

  if (!args.yes) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          batchId: manifest.batchId,
          batches: manifest.batches.length,
          applied: manifest.batches.length - pending.length,
          pending: pending.length,
          totalWrite: manifest.totalWrite
        },
        null,
        2
      )
    )
    console.log('未加 --yes，未执行任何写入。')
    return
  }
  if (pending.length === 0) {
    console.log('所有批次都已执行过（apply.jsonl 有记录），无需重复写入。')
    return
  }

  const release = acquireLock(paths, 'apply', outDir, paths.applyLock)
  installStopHandlers()
  try {
    for (const [index, batch] of pending.entries()) {
      if (stopping) break
      process.stdout.write(`[${index + 1}/${pending.length}] ${batch.count} 条 … `)
      const result = runSqlFile(batch.file)
      if (!result.ok) {
        console.error('失败')
        console.error((result.stdout + result.stderr).slice(-1500))
        console.error('该批次未记录为已执行；修复后重跑 apply 会从这一批继续。')
        process.exitCode = 1
        return
      }
      appendJsonl(paths.applied, {
        batchId: manifest.batchId,
        file: batch.file,
        count: batch.count,
        expected: batch.expected,
        appliedAt: new Date().toISOString()
      })
      console.log('ok')
    }

    const stats = fetchImportStats(manifest.uid, manifest.batchId, { tmpDir: join(outDir, 'tmp') })
    console.log(JSON.stringify({ appliedNow: pending.length, stats }, null, 2))
  } finally {
    release()
  }
}

// ---------------------------------------------------------------- rollback

/**
 * 按批次回滚：从库里读该批次的 title_hash，先删对应的 200 事件，再删标记。
 * 不删 hentai_gallery（共享目录，删了会影响其它用户）。
 * 这样即使 build 产物被清理，已执行批次仍然可回滚。
 */
function rollback(args) {
  const outDir = args.out ?? DEFAULTS.out
  const paths = filePaths(outDir)
  const batchId = args.batch
  if (!batchId) throw new Error('用法：rollback --batch <batchId> [--yes]')
  const uid = args.uid ?? DEFAULTS.uid

  const sql = `-- 回滚批次 ${batchId}：先删对应的 200 事件（依据本批标记的 hash），再删标记；画廊行保留
begin;

with t as (
  select title_hash from public.hentai_import_log where batch_id = ${sqlText(batchId)}::uuid
)
delete from public.hentai_archive_event e
using public.hentai_gallery g, t
where e.gallery_id = g.id
  and g.title_hash = t.title_hash
  and e.user_id = ${sqlText(uid)}::uuid
  and e.status = 200;

delete from public.hentai_import_log where batch_id = ${sqlText(batchId)}::uuid;

commit;
`
  ensureDir(paths.sqlDir)
  const file = join(paths.sqlDir, `rollback-${batchId}.sql`)
  writeFileSync(file, sql, 'utf8')

  if (!args.yes) {
    console.log(sql)
    console.log(`未加 --yes，未执行。已写入：${file}`)
    return
  }
  const result = runSqlFile(file)
  if (!result.ok) {
    console.error((result.stdout + result.stderr).slice(-1500))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ rolledBack: batchId, file }, null, 2))
}

// ---------------------------------------------------------------- verify-db

function verifyDb(args) {
  const outDir = args.out ?? DEFAULTS.out
  const paths = filePaths(outDir)
  const manifest = loadJson(paths.manifest, undefined)
  const uid = args.uid ?? manifest?.uid ?? DEFAULTS.uid
  const batchId = args.batch ?? manifest?.batchId
  const stats = batchId
    ? fetchImportStats(uid, batchId, { tmpDir: join(outDir, 'tmp') })
    : { note: '没有 manifest，未指定 --batch' }
  console.log(JSON.stringify(stats, null, 2))
}

// ---------------------------------------------------------------- 入口

const args = parseArgs(process.argv.slice(2))
const command = args._[0]

// 所有命令开始前都做一次状态迁移：换 agent 时只要同步 state/ 就能接着跑
if (command && command !== 'help') {
  const outDir = ensureDir(args.out ?? DEFAULTS.out)
  migrateLegacyState(filePaths(outDir), outDir)
}

const HELP = `用法：node run.mjs <命令> [选项]

命令：
  scan      扫描目录（--dir，默认 ${DEFAULTS.dir}）
  verify    校验（--limit N / --interval ms / --retry N / --cookie / --file 子串 / --force / --wait-ban）
  report    产出报告与 disputed.json
  status    交接摘要（换 agent / 中断后先看这个）
  inspect   查看单条（--file "<文件名或子串>"）
  decide    记录裁决（--file "<文件名>" --gid N [--title "..."] | --skip  [--reason "..."]）
  build     生成 SQL（--overwrite / --no-check-db / --include-fuzzy / --batch-size）
  apply     执行 SQL（必须 --yes；已执行批次自动跳过）
  rollback  按批次回滚（--batch <batchId> [--yes]；只删事件与标记，不删画廊）
  verify-db 打印导入统计

通用：--out <目录>（默认 ${DEFAULTS.out}）

状态（追加式，逐条落盘，可随时中断）：
  state/files.json        扫描快照
  state/verified.jsonl    校验结果（同名后写覆盖先写）
  state/decisions.jsonl   人工/AI 裁决
  state/apply.jsonl       已执行批次
  state/run.lock          运行锁（防止两个进程同时打站点）
  state/sql/              build 产物（batch-*.sql / rollback.sql / manifest.json）
`

switch (command) {
  case 'scan':
    scan(args)
    break
  case 'verify':
    await verify(args)
    break
  case 'report':
    report(args)
    break
  case 'status':
    status(args)
    break
  case 'inspect':
    inspect(args)
    break
  case 'decide':
    decide(args)
    break
  case 'build':
    build(args)
    break
  case 'apply':
    apply(args)
    break
  case 'rollback':
    rollback(args)
    break
  case 'verify-db':
    verifyDb(args)
    break
  default:
    console.log(HELP)
    if (command) process.exit(1)
}
