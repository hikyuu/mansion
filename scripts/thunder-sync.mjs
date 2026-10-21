#!/usr/bin/env node
/**
 * thunder-sync —— 把 torrent 目录里「迅雷还没有的任务」补充进迅雷
 *
 * 工作原理
 *   1. 读取迅雷任务库 TaskDb.dat（SQLite，迅雷运行时也可读：先复制 dat/-wal/-shm 再打开），
 *      得到所有已存在的 BT 任务 info hash（含下载中、排队、暂停、已完成）；
 *   2. 扫描 torrent 目录，解析每个 .torrent 的 info hash / 名称 / tracker，
 *      按 info hash 与迅雷任务库求差集；
 *   3. 对缺失项用 `ThunderAgent.Agent64` COM 接口 AddTask(magnet) + CommitTasks() 静默加入迅雷。
 *
 * 可随时终止 / 继续
 *   - 每个任务处理后都会落盘状态文件，Ctrl+C 或 kill 掉进程都不会丢进度；
 *   - 想暂停时新开一个终端执行 `--stop`（或直接 Ctrl+C），正在跑的循环会在下一个任务前安全退出；
 *   - 重新执行同样的命令即从断点继续，已存在于迅雷的任务自动跳过（幂等，不会重复添加）。
 *   状态文件：<脚本目录>/.thunder-sync/state.json（人可读，供其它 agent/会话查看进度）
 *             <脚本目录>/.thunder-sync/history.jsonl（逐条追加的审计日志）
 *
 * 用法
 *   node scripts/thunder-sync.mjs --status          # 只看差异与进度，不改动迅雷
 *   node scripts/thunder-sync.mjs --dry-run         # 只打印将要添加的任务
 *   node scripts/thunder-sync.mjs                   # 全量补齐（默认串行：确认上一个加成功后再加下一个）
 *   node scripts/thunder-sync.mjs --limit 20        # 本次最多添加 20 个
 *   node scripts/thunder-sync.mjs --pipeline        # 改为批量添加（不等待下载完成，按 --interval 节拍）
 *   node scripts/thunder-sync.mjs --file "L:\\Downloads\\xxx.torrent"
 *   node scripts/thunder-sync.mjs --stop            # 通知正在运行的实例暂停
 *   node scripts/thunder-sync.mjs --reset           # 清空状态与日志
 *
 * 常用参数
 *   --dir <path>       torrent 目录，默认 L:\Downloads
 *   --file <path>      只处理指定的 torrent（可重复）
 *   --profile <path>   迅雷 Profiles 目录（默认自动探测）
 *   --save <path>      下载保存目录，默认同 torrent 目录
 *   --limit <n>        本次最多添加多少个（0 = 不限）
 *   --poll <ms>        串行模式下轮询迅雷任务库的间隔，默认 2000
 *   --confirm-timeout <秒>  串行模式下「确认任务已建好」的最长等待，默认 60
 *   --wait-done        串行模式下额外等它下载完成，才添加下一个（默认只确认建好）
 *   --commit4          实验：改用 IAgent7::CommitTasks4(0, 0) 提交（会弹出“新建下载任务”窗口，需人工点“立即下载”）
 *   --commit4-async    实验：同上，nIsAsync=1
 *   --pipeline         关闭串行：不确认，按 --interval 节拍批量加入
 *   --interval <ms>    仅 --pipeline 模式的添加节拍，默认 1000（每秒一个）
 *   --timeout <min>    仅 --wait-done 模式下单个任务的最长等待（分钟），0 = 不限
 *   --manual           以「手动开始」入队（默认自动开始）
 *   --no-disk-check    不检查目标文件是否已存在于下载目录（默认检查，已下完的种子会跳过）
 *   --retry            （默认行为即重试）保留参数，便于兼容
 *
 * 依赖：Node.js >= 22.5（使用内置 node:sqlite），Windows + 迅雷 11（ThunderAgent COM）。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_DIR = path.join(SCRIPT_DIR, '.thunder-sync')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const HISTORY_FILE = path.join(STATE_DIR, 'history.jsonl')
const STOP_FILE = path.join(STATE_DIR, 'stop.flag')
const DB_COPY_DIR = path.join(STATE_DIR, 'db')
const DEFAULT_TORRENT_DIR = 'L:\\Downloads'

const PROFILE_CANDIDATES = [
  'C:\\Program Files (x86)\\Thunder Network\\Thunder\\Profiles',
  'C:\\Program Files\\Thunder Network\\Thunder\\Profiles',
  'D:\\Program Files (x86)\\Thunder Network\\Thunder\\Profiles',
  'D:\\Program Files\\Thunder Network\\Thunder\\Profiles',
]

/** 迅雷任务状态码 -> 中文（仅用于展示，判断「是否已存在」不看状态） */
const STATUS_LABEL = {
  0: '未知',
  1: '等待中',
  2: '校验中',
  3: '下载中',
  4: '已暂停',
  5: '下载中',
  6: '排队中',
  7: '未完成',
  8: '已完成',
  9: '失败',
}

// ---------------------------------------------------------------- 参数解析

function parseArgs(argv) {
  const opts = {
    dir: DEFAULT_TORRENT_DIR,
    files: [],
    profile: null,
    save: null,
    limit: 0,
    interval: 1000,
    serial: true,
    waitDone: false,
    skip: [],
    commitMode: 'legacy',
    poll: 2000,
    confirmTimeoutSec: 60,
    timeoutMin: 0,
    manual: false,
    diskCheck: true,
    mode: 'sync',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`参数 ${arg} 缺少取值`)
      return v
    }
    switch (arg) {
      case '--dir': opts.dir = next(); break
      case '--file': opts.files.push(next()); break
      case '--profile': opts.profile = next(); break
      case '--save': opts.save = next(); break
      case '--limit': opts.limit = Number(next()) || 0; break
      case '--interval': opts.interval = Number(next()) || 0; break
      case '--serial': opts.serial = true; break
      case '--pipeline': opts.serial = false; break
      case '--wait-done': opts.waitDone = true; break
      case '--check-dialog': opts.mode = 'dialog'; break
      case '--confirm-panel': opts.mode = 'confirm-panel'; break
      case '--skip': opts.skip.push(next()); break
      case '--commit4': opts.commitMode = 'c4'; break
      case '--commit4-async': opts.commitMode = 'c4a'; break
      case '--poll': opts.poll = Math.max(1000, Number(next()) || 2000); break
      case '--confirm-timeout': opts.confirmTimeoutSec = Math.max(5, Number(next()) || 60); break
      case '--timeout': opts.timeoutMin = Math.max(0, Number(next()) || 0); break
      case '--manual': opts.manual = true; break
      case '--no-disk-check': opts.diskCheck = false; break
      case '--retry': break
      case '--dry-run': opts.mode = 'dry-run'; break
      case '--status': opts.mode = 'status'; break
      case '--stop': opts.mode = 'stop'; break
      case '--reset': opts.mode = 'reset'; break
      case '-h':
      case '--help': opts.mode = 'help'; break
      default:
        throw new Error(`未知参数：${arg}（用 --help 查看用法）`)
    }
  }
  return opts
}

function printHelp() {
  const header = fs
    .readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('*/')[0]
    .replace(/^#![^\n]*\n/, '')
    .replace(/^\/\*\*?/, '')
    .replace(/^ \* ?/gm, '')
  console.log(header.trim())
}

// ---------------------------------------------------------------- 迅雷任务库

function resolveProfile(explicit) {
  const candidates = explicit ? [explicit] : PROFILE_CANDIDATES
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'TaskDb.dat'))) return dir
  }
  throw new Error(`找不到迅雷任务库 TaskDb.dat，请用 --profile 指定，例如：\n  --profile "D:\\Program Files (x86)\\Thunder Network\\Thunder\\Profiles"`)
}

function cleanStr(v) {
  return typeof v === 'string' ? v.replace(/\u0000+$/, '') : ''
}

const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 复制任务库文件。迅雷会短暂独占 -shm/-wal，
 * 因此这里做重试；-shm 是可选文件（SQLite 会自动重建），复制失败不影响读取。
 */
function copyDbFile(src, dst, optional) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.copyFileSync(src, dst)
      return true
    } catch (e) {
      if (attempt === 9) {
        if (optional) return false
        throw new Error(`复制 ${path.basename(src)} 失败（迅雷正在读写该文件），稍后重试：${e.message}`)
      }
      sleepSync(200)
    }
  }
  return false
}

/** 轮询时用：读失败（迅雷短暂锁库）不致命，返回 null 让调用方重试 */
function safeReadTasks(profileDir, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return readThunderTasks(profileDir)
    } catch {
      if (i < attempts - 1) sleepSync(300)
    }
  }
  return null
}

/** 读取迅雷任务库（先复制以免占用/锁库），返回 BT 任务列表 */
function readThunderTasks(profileDir) {
  fs.rmSync(DB_COPY_DIR, { recursive: true, force: true })
  fs.mkdirSync(DB_COPY_DIR, { recursive: true })
  const base = path.join(profileDir, 'TaskDb.dat')
  for (const suffix of ['', '-wal', '-shm']) {
    const src = base + suffix
    if (fs.existsSync(src)) copyDbFile(src, path.join(DB_COPY_DIR, 'TaskDb.dat' + suffix), suffix === '-shm')
  }

  const db = new DatabaseSync(path.join(DB_COPY_DIR, 'TaskDb.dat'))
  try {
    const rows = db
      .prepare(
        `select b.TaskId as id, b.Type as type, b.Status as status, b.Name as name,
                b.SavePath as savePath, b.ResourceSize as size, b.TotalReceiveSize as received,
                hex(t.InfoId) as infoHash
         from TaskBase b left join BtTask t on t.TaskId = b.TaskId`,
      )
      .all()
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      name: cleanStr(r.name),
      savePath: cleanStr(r.savePath),
      size: Number(r.size ?? 0),
      received: Number(r.received ?? 0),
      infoHash: r.infoHash ? String(r.infoHash).toLowerCase() : null,
    }))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------- torrent 解析

function decodeBencode(buf, pos) {
  const c = buf[pos]
  if (c === 0x69) {
    // i<int>e
    const end = buf.indexOf(0x65, pos)
    return { value: Number(buf.toString('latin1', pos + 1, end)), next: end + 1, start: pos, end: end + 1 }
  }
  if (c === 0x6c) {
    // l...e
    const arr = []
    let p = pos + 1
    while (buf[p] !== 0x65) {
      const node = decodeBencode(buf, p)
      arr.push(node.value)
      p = node.next
    }
    return { value: arr, next: p + 1, start: pos, end: p + 1 }
  }
  if (c === 0x64) {
    // d...e
    const obj = {}
    const spans = {}
    let p = pos + 1
    while (buf[p] !== 0x65) {
      const key = decodeBencode(buf, p)
      const val = decodeBencode(buf, key.next)
      const k = key.value.toString('utf8')
      obj[k] = val.value
      spans[k] = { start: val.start, end: val.end }
      p = val.next
    }
    return { value: obj, next: p + 1, start: pos, end: p + 1, spans }
  }
  // <len>:<data>
  const colon = buf.indexOf(0x3a, pos)
  const len = Number(buf.toString('latin1', pos, colon))
  const end = colon + 1 + len
  return { value: buf.slice(colon + 1, end), next: end, start: pos, end }
}

/** 解析 torrent：info hash（对 info 字典原始字节 sha1）、名称、总大小、tracker */
function parseTorrent(filePath) {
  const buf = fs.readFileSync(filePath)
  const node = decodeBencode(buf, 0)
  if (!node.spans || !node.spans.info) throw new Error('不是合法的 torrent 文件')
  const infoHash = createHash('sha1').update(buf.slice(node.spans.info.start, node.spans.info.end)).digest('hex')

  const info = node.value.info
  const name = info.name ? info.name.toString('utf8') : path.basename(filePath, '.torrent')
  const files = Array.isArray(info.files) ? info.files : null
  const length = files ? files.reduce((sum, f) => sum + Number(f.length || 0), 0) : Number(info.length || 0)

  const trackers = []
  const pushTracker = (t) => {
    const s = String(t || '').trim()
    if (s && !trackers.includes(s)) trackers.push(s)
  }
  if (node.value.announce) pushTracker(node.value.announce.toString('utf8'))
  if (Array.isArray(node.value['announce-list'])) {
    for (const tier of node.value['announce-list']) for (const t of tier) pushTracker(t.toString('utf8'))
  }
  return { filePath, infoHash, name, length, fileCount: files ? files.length : 1, trackers: trackers.slice(0, 10) }
}

function buildMagnet(info) {
  const params = [`xt=urn:btih:${info.infoHash}`]
  if (info.name) params.push('dn=' + encodeURIComponent(info.name))
  for (const tr of info.trackers) params.push('tr=' + encodeURIComponent(tr))
  return 'magnet:?' + params.join('&')
}

/** 从文件名兜底取 info hash（脚本生成的种子文件名就是 40 位 hex） */
function hashFromFileName(fileName) {
  const m = /([0-9a-fA-F]{40})/.exec(fileName.replace(/\.torrent$/i, ''))
  return m ? m[1].toLowerCase() : null
}

// ---------------------------------------------------------------- 本地文件检查

function dirTotalSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const p = path.join(cur, entry.name)
      if (entry.isDirectory()) stack.push(p)
      else if (entry.isFile()) {
        try {
          total += fs.statSync(p).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total
}

/** 下载目录里是否已有该种子的内容：'complete' | 'partial' | 'none' */
function checkOnDisk(info, saveDir) {
  const target = path.join(saveDir, info.name)
  if (!fs.existsSync(target)) return 'none'
  const stat = fs.statSync(target)
  const actual = stat.isDirectory() ? dirTotalSize(target) : stat.size
  if (!info.length) return actual > 0 ? 'partial' : 'none'
  if (actual >= info.length * 0.99) return 'complete'
  return actual > 0 ? 'partial' : 'none'
}

// ---------------------------------------------------------------- 加入迅雷

const PS_ADD_TASK = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $agent = New-Object -ComObject ThunderAgent.Agent64
  $null = $agent.AddTask($env:XL_URL, $env:XL_NAME, $env:XL_PATH, '', '', [int]$env:XL_MODE, 0, 5)
  switch ($env:XL_COMMIT) {
    'c4'  { $r = $agent.CommitTasks4(0, 0) }
    'c4a' { $r = $agent.CommitTasks4(0, 1) }
    default { $r = $agent.CommitTasks() }
  }
  [Console]::Out.WriteLine('OK ' + $r)
} catch {
  [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
}
`

function addToThunder({ magnet, name, savePath, mode, commit = 'legacy', timeout = 30000 }) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_ADD_TASK],
      {
        windowsHide: true,
        env: { ...process.env, XL_URL: magnet, XL_NAME: name, XL_PATH: savePath, XL_MODE: String(mode), XL_COMMIT: commit },
      },
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (d) => (out += d.toString('utf8')))
    child.stderr.on('data', (d) => (err += d.toString('utf8')))
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || ''
      if (line.startsWith('OK')) resolve({ ok: true, detail: line.slice(2).trim() })
      else resolve({ ok: false, detail: line.replace(/^ERR\s*/, '') || err.trim() || `退出码 ${code}` })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, detail: e.message })
    })
  })
}

/**
 * 常驻 PowerShell 工作进程：
 *   - {cmd:'add', ...}   -> 加任务，回 `OK <n>` / `ERR <msg>`
 *   - {cmd:'dialog'}     -> 探测「新建下载任务」面板是否开着，回 `DLG 1` / `DLG 0`
 * 请求/响应都是一行 base64(UTF-8 JSON) / 明文，避免中文编码问题。
 */
const PS_WORKER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Namespace Native -Name Win -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr PostMessageW(System.IntPtr hWnd, uint msg, System.IntPtr w, System.IntPtr l);
"@

function Test-NewTaskPanel {
  $global:__xlDialog = $false
  $cb = [Native.Win+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Native.Win]::IsWindowVisible($hWnd)) {
      $sb = New-Object System.Text.StringBuilder 512
      [void][Native.Win]::GetWindowTextW($hWnd, $sb, 512)
      $t = $sb.ToString()
      if ($t -match '新建.*任务') {
        $global:__xlDialog = $true
        return $false
      }
    }
    return $true
  }
  [void][Native.Win]::EnumWindows($cb, [System.IntPtr]::Zero)
  return $global:__xlDialog
}

$agent = $null
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  try {
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($line)) | ConvertFrom-Json
    if ([string]$json.cmd -eq 'dialog') {
      if (Test-NewTaskPanel) { [Console]::Out.WriteLine('DLG 1') } else { [Console]::Out.WriteLine('DLG 0') }
    } elseif ([string]$json.cmd -eq 'confirm-panel') {
      $global:__hwnd = [System.IntPtr]::Zero
      $cb2 = [Native.Win+EnumWindowsProc]{
        param($hWnd, $lParam)
        if ([Native.Win]::IsWindowVisible($hWnd)) {
          $sb2 = New-Object System.Text.StringBuilder 512
          [void][Native.Win]::GetWindowTextW($hWnd, $sb2, 512)
          if ($sb2.ToString() -match '新建.*任务') { $global:__hwnd = $hWnd; return $false }
        }
        return $true
      }
      [void][Native.Win]::EnumWindows($cb2, [System.IntPtr]::Zero)
      if ($global:__hwnd -eq [System.IntPtr]::Zero) {
        [Console]::Out.WriteLine('PANEL 0')
      } else {
        [void][Native.Win]::SetForegroundWindow($global:__hwnd)
        Start-Sleep -Milliseconds 300
        try { (New-Object -ComObject WScript.Shell).SendKeys('{ENTER}') } catch { }
        Start-Sleep -Milliseconds 800
        if (Test-NewTaskPanel) {
          # 前台输入可能被系统拦掉，退回直接投递按键消息给面板窗口（WM_KEYDOWN/UP VK_RETURN）
          [void][Native.Win]::PostMessageW($global:__hwnd, 0x0100, [System.IntPtr]0x0D, [System.IntPtr]0)
          Start-Sleep -Milliseconds 120
          [void][Native.Win]::PostMessageW($global:__hwnd, 0x0101, [System.IntPtr]0x0D, [System.IntPtr]0)
        }
        Start-Sleep -Milliseconds 1500
        if (Test-NewTaskPanel) { [Console]::Out.WriteLine('PANEL 1') } else { [Console]::Out.WriteLine('PANEL 0') }
      }
    } else {
      if ($null -eq $agent) { $agent = New-Object -ComObject ThunderAgent.Agent64 }
      $null = $agent.AddTask([string]$json.url, [string]$json.name, [string]$json.path, '', '', [int]$json.mode, 0, 5)
      switch ([string]$json.commit) {
        'c4'  { $r = $agent.CommitTasks4(0, 0) }
        'c4a' { $r = $agent.CommitTasks4(0, 1) }
        default { $r = $agent.CommitTasks() }
      }
      [Console]::Out.WriteLine('OK ' + $r)
    }
  } catch {
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
    $agent = $null
  }
  [Console]::Out.Flush()
}
`

function createThunderWorker() {
  let child = null
  let alive = false
  let buffer = ''
  let pending = null
  let timer = null

  function finish(result) {
    if (timer) clearTimeout(timer)
    timer = null
    const p = pending
    pending = null
    if (p && typeof p.resolve === 'function') p.resolve(result)
  }

  function onLine(line) {
    if (!pending) return
    if (pending.kind === 'dialog') return finish({ ok: true, open: line.startsWith('DLG 1') })
    if (pending.kind === 'confirm') return finish({ ok: true, closed: line.startsWith('PANEL 0') })
    if (line.startsWith('OK')) finish({ ok: true, detail: line.slice(2).trim() })
    else finish({ ok: false, detail: line.replace(/^ERR\s*/, '') || '未知错误' })
  }

  function start() {
    buffer = ''
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_WORKER],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    alive = true
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) onLine(line)
      }
    })
    child.stderr.on('data', () => {})
    child.on('close', () => {
      alive = false
      child = null
      finish({ ok: false, detail: '工作进程已退出' })
    })
    child.on('error', (e) => {
      alive = false
      child = null
      finish({ ok: false, detail: e.message })
    })
  }

  function request(payload, kind, timeout) {
    if (!alive) start()
    return new Promise((resolve) => {
      pending = { resolve, kind }
      timer = setTimeout(() => {
        finish({ ok: false, detail: '请求超时' })
        if (kind !== 'dialog') kill()
      }, timeout)
      child.stdin.write(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') + '\n')
    })
  }

  function kill() {
    alive = false
    if (child) {
      try {
        child.stdin.end()
        child.kill()
      } catch {
        /* ignore */
      }
      child = null
    }
  }

  return {
    get alive() {
      return alive
    },
    add(task) {
      return request({ ...task, cmd: 'add' }, 'add', 30000)
    },
    /** 探测迅雷「新建下载任务」面板是否还开着（CommitTasks4 走交互式提交时会弹这个） */
    async dialogOpen() {
      const r = await request({ cmd: 'dialog' }, 'dialog', 10000)
      return Boolean(r.open)
    },
    /** 给面板发回车（默认按钮＝立即下载），返回面板是否已关闭 */
    async confirmPanel() {
      const r = await request({ cmd: 'confirm-panel' }, 'confirm', 15000)
      return Boolean(r.closed)
    },
    kill,
  }
}

// ---------------------------------------------------------------- 状态与日志

function emptyState(torrentDir) {
  return { version: 1, torrentDir, createdAt: new Date().toISOString(), updatedAt: null, items: {}, runs: [] }
}

function loadState(torrentDir) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const state = JSON.parse(raw)
    if (!state.items) state.items = {}
    if (!state.runs) state.runs = []
    return state
  } catch {
    return emptyState(torrentDir)
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function appendHistory(record) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.appendFileSync(HISTORY_FILE, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', 'utf8')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Number(bytes) || 0
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`
}

// ---------------------------------------------------------------- 主流程

function collectTorrents(opts) {
  const torrentDir = path.resolve(opts.dir)
  const files = opts.files.length
    ? opts.files.map((f) => path.resolve(f))
    : fs
        .readdirSync(torrentDir)
        .filter((f) => f.toLowerCase().endsWith('.torrent'))
        .map((f) => path.join(torrentDir, f))

  const items = []
  const problems = []
  for (const file of files) {
    try {
      const info = parseTorrent(file)
      items.push(info)
    } catch (e) {
      const fallback = hashFromFileName(path.basename(file))
      if (fallback) items.push({ filePath: file, infoHash: fallback, name: path.basename(file, '.torrent'), length: 0, trackers: [] })
      else problems.push({ file, error: e.message })
    }
  }
  return { torrentDir, items, problems }
}

function summarize(tasks) {
  const bt = tasks.filter((t) => t.infoHash)
  const groups = {}
  for (const t of bt) {
    const key = STATUS_LABEL[t.status] ?? `状态${t.status}`
    groups[key] = (groups[key] || 0) + 1
  }
  return { btCount: bt.length, groups }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.mode === 'help') return printHelp()

  if (opts.mode === 'stop') {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(STOP_FILE, new Date().toISOString(), 'utf8')
    console.log(`已写入停止标记：${STOP_FILE}\n正在运行的实例会在处理完当前任务后退出（状态已保存，可随时重新运行继续）。`)
    return
  }

  if (opts.mode === 'reset') {
    fs.rmSync(STATE_DIR, { recursive: true, force: true })
    console.log(`已清空状态目录：${STATE_DIR}`)
    return
  }

  if (opts.mode === 'confirm-panel') {
    // 给「新建任务面板」发回车（默认按钮＝立即下载），把排在面板里的任务入库
    const probe = createThunderWorker()
    const open = await probe.dialogOpen()
    if (!open) {
      probe.kill()
      console.log('迅雷「新建任务面板」未打开，无需确认。')
      return
    }
    const closed = await probe.confirmPanel()
    probe.kill()
    console.log(closed ? '已发送回车，面板已关闭（任务已提交入库）。' : '已发送回车，但面板仍在——可能被别的窗口挡住了，请手动点“立即下载”。')
    return
  }

  if (opts.mode === 'dialog') {
    // 探测迅雷「新建下载任务」面板是否开着（CommitTasks4 交互式提交的回调点）
    const probe = createThunderWorker()
    const open = await probe.dialogOpen()
    probe.kill()
    console.log(open ? '迅雷「新建下载任务」面板：已打开（有待人工确认的任务）' : '迅雷「新建下载任务」面板：未打开')
    return
  }

  const profileDir = resolveProfile(opts.profile)
  const saveDir = opts.save ? path.resolve(opts.save) : null
  const { torrentDir, items, problems } = collectTorrents(opts)
  const tasks = readThunderTasks(profileDir)
  const existing = new Set(tasks.filter((t) => t.infoHash).map((t) => t.infoHash))
  const summary = summarize(tasks)

  // 去重（同一 info hash 的多个种子文件，例如 xxx(1).torrent）
  const unique = new Map()
  for (const info of items) if (!unique.has(info.infoHash)) unique.set(info.infoHash, info)
  const all = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  const state = loadState(torrentDir)
  state.torrentDir = torrentDir

  const missing = []
  const onDisk = []
  for (const info of all) {
    if (existing.has(info.infoHash)) continue
    const dir = saveDir || path.dirname(info.filePath)
    if (opts.diskCheck && info.length > 0 && checkOnDisk(info, dir) === 'complete') {
      onDisk.push(info)
      continue
    }
    missing.push(info)
  }

  console.log('迅雷任务库 :', profileDir)
  console.log('torrent 目录:', torrentDir, `（${all.length} 个种子，去重后）`)
  console.log('迅雷 BT 任务:', summary.btCount, '个 ——', Object.entries(summary.groups).map(([k, v]) => `${k} ${v}`).join(' / '))
  console.log('已存在于迅雷:', all.length - missing.length - onDisk.length, '个')
  console.log('本地已下完（跳过）:', onDisk.length, '个')
  console.log('待添加:', missing.length, '个')
  if (problems.length) console.log('无法解析的种子:', problems.length, '个 ->', problems.slice(0, 3).map((p) => path.basename(p.file)).join(', '))

  if (opts.mode === 'status') {
    const pending = missing.length
    const failures = Object.values(state.items).filter((i) => i.result === 'failed')
    console.log('\n状态文件:', STATE_FILE)
    console.log('历史日志:', HISTORY_FILE)
    console.log('上次运行:', state.updatedAt || '（从未运行）')
    console.log('本次待处理:', pending, '个；历史失败记录:', failures.length, '个')
    if (failures.length) {
      for (const f of failures.slice(0, 10)) console.log('  失败:', f.name || f.file, '-', f.error)
    }
    saveState(state)
    return
  }

  if (opts.mode === 'dry-run') {
    for (const info of missing.slice(0, 200)) console.log('  待添加:', info.name, `(${info.infoHash.slice(0, 8)}…)`)
    if (missing.length > 200) console.log(`  …… 其余 ${missing.length - 200} 个省略`)
    return
  }

  // ---- 正式添加（可中断 / 可续跑）
  fs.mkdirSync(STATE_DIR, { recursive: true })
  if (fs.existsSync(STOP_FILE)) {
    fs.rmSync(STOP_FILE)
    console.log('检测到遗留的停止标记，已清理并继续（如需暂停请用 --stop）。')
  }

  let stopping = false
  process.on('SIGINT', () => {
    if (stopping) process.exit(130)
    stopping = true
    console.log('\n收到 Ctrl+C：当前任务处理完后退出，进度已保存。再次运行即可继续。')
  })

  const run = {
    startedAt: new Date().toISOString(),
    added: 0,
    failed: 0,
    stopped: false,
    serial: opts.serial,
    limit: opts.limit,
    manual: opts.manual,
    interval: opts.interval,
    poll: opts.poll,
  }
  state.runs.push(run)
  if (state.runs.length > 50) state.runs = state.runs.slice(-50)
  saveState(state)

  let added = 0
  let failed = 0
  const addedHashes = []
  const worker = createThunderWorker()
  const intervalMs = Math.max(0, opts.interval)
  let nextAt = 0

  const commitLabel = { legacy: 'CommitTasks()', c4: 'CommitTasks4(0, 0)', c4a: 'CommitTasks4(0, 1)' }[opts.commitMode]
  if (opts.commitMode !== 'legacy') {
    console.log('⚠ CommitTasks4 是“交互式提交”：它会弹出迅雷的「新建下载任务」窗口，任务要点“立即下载”才真正入库，')
    console.log('  批量场景请勿使用；确认它是否可用只看窗口有没有弹出来。\n')
  }
  if (opts.serial && opts.waitDone) {
    console.log(`模式：串行 + 等下载完成 —— 上一个任务下完才添加下一个（轮询 ${opts.poll}ms，提交方式 ${commitLabel}）\n`)
  } else if (opts.serial) {
    console.log(`模式：串行 —— 添加一个，确认它已在迅雷里建好，再添加下一个（轮询 ${opts.poll}ms，提交方式 ${commitLabel}）\n`)
  } else {
    console.log(`模式：批量 —— 每 ${intervalMs}ms 添加一个（提交方式 ${commitLabel}）\n`)
  }

  /** 把单个种子加入迅雷并落盘；pacing=true 时按 --interval 节拍（仅批量模式） */
  const addOne = async (info, pacing) => {
    const target = saveDir || path.dirname(info.filePath)
    const label = `[${added + failed + 1}/${missing.length}] ${info.name}`

    if (pacing && intervalMs > 0 && nextAt > Date.now()) await sleep(nextAt - Date.now())
    nextAt = Math.max(Date.now(), nextAt) + intervalMs

    const payload = { url: buildMagnet(info), name: info.name, path: target, mode: opts.manual ? 1 : 0, commit: opts.commitMode }
    let result = await worker.add(payload)
    if (!result.ok && !worker.alive) {
      // 常驻工作进程异常时退回「每次新起 PowerShell」，保证不中断
      result = await addToThunder({
        magnet: payload.url,
        name: payload.name,
        savePath: payload.path,
        mode: payload.mode,
        commit: payload.commit,
      })
    }

    const record = {
      file: path.basename(info.filePath),
      name: info.name,
      infoHash: info.infoHash,
      result: result.ok ? 'added' : 'failed',
      error: result.ok ? undefined : result.detail,
    }
    state.items[info.infoHash] = { ...record, at: new Date().toISOString() }
    appendHistory(record)
    saveState(state)

    if (result.ok) {
      added++
      addedHashes.push(info.infoHash)
      console.log(`✔ ${label}`)
    } else {
      failed++
      console.log(`✘ ${label} —— ${result.detail}`)
    }
    return result
  }

  /** 串行确认：轮询任务库，直到这个任务真的出现在迅雷里（确认添加成功） */
  const confirmAdded = async (info) => {
    const began = Date.now()
    const deadline = began + opts.confirmTimeoutSec * 1000
    while (true) {
      await sleep(Math.min(opts.poll, 2000))
      if (stopping || fs.existsSync(STOP_FILE)) return 'stopped'
      const snapshot = safeReadTasks(profileDir)
      if (!snapshot) continue
      const task = snapshot.find((t) => t.infoHash === info.infoHash)
      if (task) {
        const item = state.items[info.infoHash]
        if (item) {
          item.waitState = 'confirmed'
          item.thunderStatus = STATUS_LABEL[task.status] ?? `状态${task.status}`
          saveState(state)
        }
        console.log(`  ✔ 迅雷已确认入队（${STATUS_LABEL[task.status] ?? '状态' + task.status}），用时 ${((Date.now() - began) / 1000).toFixed(1)}s`)
        return 'confirmed'
      }
      // 任务还没入库：看看是不是卡在「新建下载任务」面板上等人工确认
      if (await worker.dialogOpen()) {
        const item = state.items[info.infoHash]
        if (item && item.waitState !== 'dialog') {
          item.waitState = 'dialog'
          saveState(state)
          console.log('  ⏳ 检测到迅雷「新建下载任务」面板，任务在等你点“立即下载”…')
        }
      }

      if (Date.now() > deadline) return 'unconfirmed'
    }
  }

  /** --wait-done：轮询任务库，直到该任务下载完成 / 被移除 / 失败 */
  const waitForCompletion = async (info) => {
    const began = Date.now()
    const timeoutMs = opts.timeoutMin * 60000
    let seen = false
    let absentRounds = 0
    while (true) {
      await sleep(opts.poll)
      if (stopping || fs.existsSync(STOP_FILE)) return 'stopped'
      if (timeoutMs && Date.now() - began > timeoutMs) return 'timeout'

      const snapshot = safeReadTasks(profileDir)
      if (!snapshot) continue
      const task = snapshot.find((t) => t.infoHash === info.infoHash)
      if (!task) {
        if (seen) return 'removed'
        if (++absentRounds >= Math.ceil(60000 / opts.poll)) return 'absent'
        continue
      }
      seen = true
      const done = task.status === 8 || (task.size > 0 && task.received >= task.size * 0.999)
      if (done) return 'completed'
      if (task.status === 9) return 'failed'

      const pct = task.size > 0 ? ((task.received / task.size) * 100).toFixed(1) : '?'
      const item = state.items[info.infoHash]
      if (item) {
        item.waitState = 'downloading'
        item.progress = Number(pct)
        saveState(state)
      }
      console.log(`  … 下载中 ${pct}%  ${formatSize(task.received)}/${formatSize(task.size)}`)
    }
  }

  // 队列：跳过 --skip 指定的 hash；历史确认失败的排到后面，避免同一个卡住的任务每次都被先试
  const attemptsOf = (hash) => Number(state.items[hash]?.attempts || 0)
  const queue = missing
    .filter((info) => !opts.skip.some((s) => info.infoHash.toLowerCase().startsWith(s.toLowerCase())))
    .sort((a, b) => attemptsOf(a.infoHash) - attemptsOf(b.infoHash))
  if (opts.skip.length) console.log(`已按 --skip 跳过 ${missing.length - queue.length} 个任务`)

  try {
    for (let i = 0; i < queue.length; i++) {
      if (stopping || fs.existsSync(STOP_FILE)) {
        run.stopped = true
        break
      }
      if (opts.limit > 0 && added + failed >= opts.limit) break

      const info = queue[i]
      const result = await addOne(info, !opts.serial)
      if (!result.ok || !opts.serial) continue

      if (!opts.waitDone) {
        // 默认：确认这个任务已在迅雷里建好，再添加下一个
        const confirmed = await confirmAdded(info)
        if (confirmed === 'stopped') {
          run.stopped = true
          break
        }
        if (confirmed === 'unconfirmed') {
          const item = state.items[info.infoHash]
          if (item) {
            item.attempts = attemptsOf(info.infoHash) + 1
            saveState(state)
          }
          console.log(`  ⚠ ${opts.confirmTimeoutSec}s 内未在迅雷任务库确认，继续下一个（可用 --status 复查）`)
        }
        continue
      }

      // --wait-done：等它下载完再添加下一个
      const waited = await waitForCompletion(info)
      const item = state.items[info.infoHash]
      if (item) {
        item.waitState = waited
        delete item.progress
        saveState(state)
      }
      if (waited === 'stopped') {
        run.stopped = true
        break
      }
      if (waited === 'completed') console.log('  ✔ 已下载完成')
      else if (waited === 'timeout') console.log('  ⏱ 等待超时（任务仍在迅雷里），继续下一个')
      else if (waited === 'failed') console.log('  ✘ 迅雷报告任务失败，继续下一个')
      else if (waited === 'removed') console.log('  ⚠ 任务已从迅雷中移除，继续下一个')
      else console.log('  ⚠ 任务未出现在迅雷任务库，继续下一个')
    }
  } finally {
    worker.kill()
  }

  run.added = added
  run.failed = failed
  saveState(state)

  // ---- 收尾：等迅雷把任务写进库，再核对一次
  if (addedHashes.length) {
    await sleep(2000)
    const after = new Set((safeReadTasks(profileDir) ?? []).filter((t) => t.infoHash).map((t) => t.infoHash))
    const lost = addedHashes.filter((h) => !after.has(h))
    console.log(`\n已提交 ${addedHashes.length} 个任务，迅雷任务库已确认 ${addedHashes.length - lost.length} 个。`)
    if (lost.length) console.log(`未确认 ${lost.length} 个（可能仍在解析元数据，稍后用 --status 复查）：${lost.slice(0, 5).join(', ')}`)
  }

  const remain = missing.length - added - failed
  console.log(`\n本次结果：新增 ${added} 个，失败 ${failed} 个，未处理 ${Math.max(0, remain)} 个。`)
  if (run.stopped) console.log('已按停止标记/中断退出，重新运行同一命令即可从断点继续。')
  else if (remain > 0) console.log('还有剩余任务（受 --limit 限制），再次运行即可继续。')
}

main().catch((e) => {
  console.error('执行失败:', e.message)
  process.exitCode = 1
})
