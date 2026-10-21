/**
 * supabase CLI 的薄封装。
 *
 * 为什么不在脚本里用 supabase-js：补录属于一次性运维，直接以 `supabase db query --linked`
 * 走 Management API（postgres 身份）更省事；但也因此绕过了 RLS 与 RPC，
 * 生成 SQL 时必须自己复刻 RPC 的语义（见 run.mjs 的 build 部分）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sqlText } from './lib.mjs'

const CLI = process.platform === 'win32' ? 'supabase.exe' : 'supabase'

/**
 * 从 CLI 输出里抠出 JSON。
 * stdout 形如：
 *   Initialising login role...
 *   [ { ... } ]
 *   posthog ... WARN ...
 */
function extractJson(text) {
  const start = text.search(/^[[{]/m)
  if (start < 0) return undefined
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
  if (end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** 执行一个 SQL 文件；返回 { ok, rows, stdout, stderr } */
export function runSqlFile(file, options = {}) {
  const result = spawnSync(CLI, ['db', 'query', '-f', file, '--linked', '--agent=no', '-o', 'json'], {
    encoding: 'utf8',
    cwd: options.cwd ?? process.cwd(),
    maxBuffer: 32 * 1024 * 1024
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (result.status !== 0 || /unexpected status|ERROR:/i.test(stdout)) {
    return { ok: false, rows: undefined, stdout, stderr }
  }
  return { ok: true, rows: extractJson(stdout), stdout, stderr }
}

/** 执行一段内联 SQL（写临时文件，避免命令行长度限制与引号转义） */
export function runSql(sql, options = {}) {
  const dir = options.tmpDir
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `query-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sql`)
  writeFileSync(file, sql, 'utf8')
  return runSqlFile(file, options)
}

/** 查询并返回行数组；失败抛错（带 CLI 输出的前 800 字符） */
export function queryRows(sql, options = {}) {
  const result = runSql(sql, options)
  if (!result.ok) {
    throw new Error(`SQL 执行失败：${(result.stdout + result.stderr).slice(0, 800)}`)
  }
  return Array.isArray(result.rows) ? result.rows : []
}

/**
 * 批量查「目标用户已归档过」的 title_hash（build 时用于跳过）。
 *
 * 注意不能只看 hentai_gallery 是否存在：那是**全局共享目录**，别的用户归档过也会有一行。
 * 判重必须落到自己的事件上（200 已下载 / 304 只有过时种子），否则会给别人归档过的画廊
 * 误判成"我已经下过"，从而漏写自己的归档。
 * 分块 200 个，避免单条 SQL 过长。
 */
export function fetchExistingHashes(hashes, options = {}) {
  const uid = options.uid
  if (!uid) throw new Error('fetchExistingHashes 需要 target uid（按用户事件判重）')
  const unique = Array.from(new Set(hashes.filter(Boolean)))
  const existing = new Set()
  const chunkSize = 200
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const list = chunk.map((hash) => sqlText(hash)).join(',')
    const rows = queryRows(
      `select g.title_hash
         from public.hentai_gallery g
         join public.hentai_archive_event e
           on e.gallery_id = g.id
          and e.user_id = ${sqlText(uid)}::uuid
          and e.status in (200, 304)
        where g.title_hash in (${list});`,
      options
    )
    rows.forEach((row) => existing.add(row.title_hash))
  }
  return existing
}

/** 读取一个用户的事件/标记数量，用于 apply 后核对 */
export function fetchImportStats(userId, batchId, options = {}) {
  const rows = queryRows(
    `select
       (select count(*) from public.hentai_archive_event where user_id = ${sqlText(userId)} and status = 200) as events_200,
       (select count(*) from public.hentai_import_log where user_id = ${sqlText(userId)}) as log_rows,
       (select count(*) from public.hentai_import_log where batch_id = ${sqlText(batchId)}::uuid) as batch_rows,
       (select count(*) from public.hentai_import_log l
          left join public.hentai_archive v on v.user_id = l.user_id and v.title_hash = l.title_hash
         where l.user_id = ${sqlText(userId)} and v.id is null) as orphan_logs;`,
    options
  )
  return rows[0]
}
