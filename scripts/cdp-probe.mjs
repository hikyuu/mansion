#!/usr/bin/env node
/**
 * 零依赖 CDP 探针：直连带 --remote-debugging-port 启动的 Chrome/Edge。
 *
 * 为什么需要它：脚本里的 GM_xmlhttpRequest 由扩展后台发起，页面 DevTools 的 Network 面板
 * 根本看不到这些请求；能观察的只有页面 console 与「同源 fetch 复现」两条路。
 *
 * 用法：
 *   node scripts/cdp-probe.mjs list
 *   node scripts/cdp-probe.mjs eval "document.title"
 *   node scripts/cdp-probe.mjs console 30
 *   node scripts/cdp-probe.mjs net onejav 30
 *   node scripts/cdp-probe.mjs cookies onejav.com
 *
 * 环境变量：
 *   CDP_URL     调试端点，默认 http://127.0.0.1:9223
 *   CDP_PAGE    目标页 URL 子串（多标签时指定用），默认优先挑含 onejav 的页面
 */

const BASE = (process.env.CDP_URL ?? 'http://127.0.0.1:9223').replace(/\/$/, '')
const PAGE_HINT = process.env.CDP_PAGE ?? 'onejav'

async function getJson(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`CDP ${path} 返回 HTTP ${res.status}（调试端口没开或已被占用）`)
  return res.json()
}

class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', (event) => this.onMessage(event.data))
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
    })
    return new CdpSession(ws)
  }

  onMessage(raw) {
    const msg = JSON.parse(raw)
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
      return
    }
    for (const listener of this.listeners) listener(msg)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(listener) {
    this.listeners.add(listener)
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // 关闭失败不影响结果
    }
  }
}

function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (pages.length === 0) throw new Error('没有可用的 page target')
  return pages.find((t) => (t.url ?? '').includes(PAGE_HINT)) ?? pages[0]
}

async function connectPage() {
  const target = pickPage(await getJson('/json/list'))
  console.log(`# 目标页面 ${target.url}`)
  return CdpSession.connect(target.webSocketDebuggerUrl)
}

function formatArg(arg) {
  if (!arg) return ''
  if ('value' in arg) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)
  return arg.description ?? arg.unserializableValue ?? arg.type
}

async function commandList() {
  const targets = await getJson('/json/list')
  for (const target of targets) {
    console.log(`${target.type}\t${target.title ?? ''}\t${target.url}`)
  }
}

async function commandEval(expression) {
  if (!expression) throw new Error('用法：eval "<表达式>"')
  const session = await connectPage()
  try {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    console.log(JSON.stringify(result.result.value, null, 2))
  } finally {
    session.close()
  }
}

async function commandConsole(seconds = 30) {
  const session = await connectPage()
  await session.send('Runtime.enable')
  session.on((msg) => {
    if (msg.method !== 'Runtime.consoleAPICalled') return
    const { type, args } = msg.params
    console.log(`[${type}] ${args.map(formatArg).join(' ')}`)
  })
  console.log(`# 监听 console ${seconds}s（Ctrl+C 结束）`)
  await sleep(seconds * 1000)
  session.close()
}

async function commandNet(substr = '', seconds = 30) {
  const session = await connectPage()
  await session.send('Network.enable')
  session.on((msg) => {
    if (msg.method !== 'Network.responseReceived') return
    const { requestId, response } = msg.params
    if (substr && !response.url.includes(substr)) return
    console.log(`\n${response.status} ${response.url}`)
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      console.log(`  ${key}: ${value}`)
    }
    session
      .send('Network.getResponseBody', { requestId })
      .then((body) => {
        const text = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8')
          : body.body
        console.log(`  body: ${text.slice(0, 1500).replace(/\s+/g, ' ')}`)
      })
      .catch(() => {
        // 重定向/307 等响应没有 body，忽略
      })
  })
  console.log(`# 监听网络 ${seconds}s，过滤 "${substr}"`)
  await sleep(seconds * 1000)
  session.close()
}

async function commandPage() {
  // 表达式写在脚本里，避免 PowerShell 对引号/反斜杠的二次解析
  const expression = `JSON.stringify({
    title: document.title,
    url: location.href,
    challenge: document.documentElement.innerHTML.includes('_cf_chl_opt'),
    cards: [...document.querySelectorAll('div.card.mb-3')].map((c) => c.id),
    anchors: [...document.querySelectorAll('a[title]')].slice(0, 10).map((a) => ({
      title: a.title,
      href: a.getAttribute('href'),
      ancestorId: a.closest('[id]')?.id ?? ''
    })),
    ids: [...document.querySelectorAll('[id]')].slice(0, 20).map((e) => e.id)
  })`
  await commandEval(expression)
}

async function commandFetch(target) {
  if (!target) throw new Error('用法：fetch <地址>（相对路径即页面同源）')
  const expression = `(async () => {
    const res = await fetch(${JSON.stringify(target)}, { credentials: 'include' })
    const text = await res.text()
    return JSON.stringify({
      status: res.status,
      type: res.headers.get('content-type'),
      ray: res.headers.get('cf-ray'),
      mitigated: res.headers.get('cf-mitigated'),
      server: res.headers.get('server'),
      head: text.slice(0, 200)
    })
  })()`
  await commandEval(expression)
}

async function commandNavigate(target, seconds = 15) {
  if (!target) throw new Error('用法：navigate <url> [秒数]')
  const session = await connectPage()
  await session.send('Network.enable')
  await session.send('Page.enable')
  session.on((msg) => {
    if (msg.method !== 'Network.responseReceived') return
    const { response } = msg.params
    console.log(`${response.status} ${response.mimeType ?? ''} ${response.url}`)
  })
  const result = await session.send('Page.navigate', { url: target })
  console.log(`# Page.navigate → ${JSON.stringify(result)}`)
  await sleep(seconds * 1000)
  session.close()
}

/** 触发页面动作并把期间的 console 打出来：click <选择器> / key Enter */
async function commandTrigger(mode, value, seconds = 25) {
  const session = await connectPage()
  await session.send('Runtime.enable')
  session.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params
      console.log(`[${type}] ${args.map(formatArg).join(' ')}`)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails
      console.log(`[exception] ${detail.exception?.description ?? detail.text}`)
    }
  })

  if (mode === 'key') {
    const key = value || 'Enter'
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: 13
    })
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: 13
    })
    console.log(`# 已发送按键 ${key}`)
  } else {
    const expression = `document.querySelector(${JSON.stringify(value)})?.click()`
    await session.send('Runtime.evaluate', { expression, userGesture: true })
    console.log(`# 已点击 ${value}`)
  }

  await sleep(seconds * 1000)
  session.close()
}

async function commandCookies(domain) {
  if (!domain) throw new Error('用法：cookies <domain>')
  const session = await connectPage()
  try {
    const result = await session.send('Network.getCookies', { urls: [`https://${domain}/`] })
    for (const cookie of result.cookies) {
      const expires = cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : 'session'
      const value = cookie.name === 'cf_clearance' ? `${cookie.value.slice(0, 8)}…（已脱敏）` : cookie.value
      console.log(`${cookie.name}=${value}  domain=${cookie.domain} expires=${expires}`)
    }
  } finally {
    session.close()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const [command = 'list', ...rest] = process.argv.slice(2)

const commands = {
  list: () => commandList(),
  page: () => commandPage(),
  fetch: () => commandFetch(rest[0]),
  navigate: () => commandNavigate(rest[0], Number(rest[1]) || 15),
  click: () => commandTrigger('click', rest[0], Number(rest[1]) || 25),
  key: () => commandTrigger('key', rest[0], Number(rest[1]) || 25),
  eval: () => commandEval(rest.join(' ')),
  console: () => commandConsole(Number(rest[0]) || 30),
  net: () => commandNet(rest[0] ?? '', Number(rest[1]) || 30),
  cookies: () => commandCookies(rest[0])
}

const run = commands[command]
if (!run) {
  console.error(`未知命令 ${command}，可用：${Object.keys(commands).join(' / ')}`)
  process.exit(1)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
