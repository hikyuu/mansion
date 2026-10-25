#!/usr/bin/env node
/**
 * 一次性取证：onejav 种子链接的 Cloudflare 挑战能否由 FlareSolverr 代过，
 * 以及它换回的 cf_clearance 能否被浏览器（Edge）复用。
 *
 * 用法：node scripts/cf-clearance-probe.mjs "<torrent url>"
 * 环境变量：CDP_URL（默认 http://127.0.0.1:9223）、FLARE_URL（默认 http://192.168.31.1:8191/v1）
 *
 * 全程不打印 cookie 原文，只打印长度与是否拿到。
 */

const CDP = (process.env.CDP_URL ?? 'http://127.0.0.1:9223').replace(/\/$/, '')
const FLARE = process.env.FLARE_URL ?? 'http://192.168.31.1:8191/v1'
const TARGET = process.argv[2]

if (!TARGET) {
  console.error('用法：node scripts/cf-clearance-probe.mjs "<torrent url>"')
  process.exit(1)
}

async function cdpJson(path) {
  const res = await fetch(CDP + path)
  if (!res.ok) throw new Error(`CDP ${path} 返回 HTTP ${res.status}`)
  return res.json()
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
    })
    return new Session(ws)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // 忽略
    }
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function flare(body) {
  const res = await fetch(FLARE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await res.json()
  if (json.status !== 'ok') throw new Error(`FlareSolverr: ${json.message ?? 'unknown'}`)
  return json
}

async function fetchInPage(session, url) {
  const expression = `(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' })
    const text = await res.text()
    return JSON.stringify({
      status: res.status,
      type: res.headers.get('content-type'),
      ray: res.headers.get('cf-ray'),
      mitigated: res.headers.get('cf-mitigated'),
      head: text.slice(0, 120)
    })
  })()`
  return JSON.parse(await evaluate(session, expression))
}

async function main() {
  const pages = (await cdpJson('/json/list')).filter((t) => t.type === 'page' && (t.url ?? '').includes('onejav'))
  if (pages.length === 0) throw new Error('没有 onejav 标签页，先在调试实例里打开 onejav')
  const session = await Session.connect(pages[0].webSocketDebuggerUrl)

  try {
    const ua = await evaluate(session, 'navigator.userAgent')
    console.log(`Edge UA: ${ua}`)

    const { cookies } = await session.send('Network.getCookies', { urls: ['https://onejav.com/'] })
    console.log(`浏览器 cookie: ${cookies.map((c) => c.name).join(', ') || '（无）'}`)

    console.log('\n1) 浏览器同源 fetch 种子链接')
    console.log(await fetchInPage(session, TARGET))

    console.log('\n2) FlareSolverr 过挑战（带浏览器 UA + cookie）')
    const created = await flare({ cmd: 'sessions.create', session: 'probe-onejav' })
    const flareSession = created.session
    try {
      const result = await flare({
        cmd: 'request.get',
        url: TARGET,
        session: flareSession,
        userAgent: ua,
        maxTimeout: 60000,
        cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain }))
      })
      const solution = result.solution
      const body = solution.response ?? solution.rawResponse ?? ''
      console.log({
        status: solution.status,
        url: solution.url,
        cookies: Object.keys(solution.cookies ?? {}),
        bodyLength: body.length,
        head: String(body).slice(0, 120)
      })

      const clearance = solution.cookies?.cf_clearance
      console.log(`\n3) 把 FlareSolverr 的 cf_clearance 注入浏览器（长度 ${clearance ? clearance.length : 0}）`)
      if (!clearance) {
        console.log('没有拿到 cf_clearance，停止')
        return
      }

      await session.send('Network.setCookie', {
        name: 'cf_clearance',
        value: clearance,
        domain: '.onejav.com',
        path: '/',
        secure: true,
        httpOnly: false
      })

      console.log('\n4) 带新凭据再 fetch 一次')
      console.log(await fetchInPage(session, TARGET))
    } finally {
      await flare({ cmd: 'sessions.destroy', session: flareSession }).catch(() => {})
    }
  } finally {
    session.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
