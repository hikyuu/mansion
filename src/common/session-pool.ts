import { LockPool } from '@/common/lock-pool.ts'
import {
  createSession,
  destroySession,
  ensureSessionAlive,
  withRetry,
  DEFAULT_SESSION_TTL_MINUTES,
  getFromFlareSolverr
} from '@/common/flare-solverr.ts'
import type { GmCallbackCookie } from '@/common/flare-solverr.ts'
import type { Solution } from 'flare-solverr'
import { GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client'

// ========== 存储 ==========

const STORAGE_KEY = 'flare-solverr-sessions'

interface PersistedSession {
  site: string
  sessionId: string
  createdAt: number
  ttlMinutes: number
}

function persistSessions(entries: Map<string, SessionEntry>): void {
  const data: PersistedSession[] = []
  for (const [, entry] of entries) {
    data.push({
      site: entry.site,
      sessionId: entry.sessionId,
      createdAt: entry.createdAt,
      ttlMinutes: entry.ttlMinutes
    })
  }
  GM_setValue(STORAGE_KEY, data)
}

function loadPersistedSessions(): Map<string, SessionEntry> {
  const data = GM_getValue<PersistedSession[] | undefined>(STORAGE_KEY, undefined)
  const entries = new Map<string, SessionEntry>()
  if (data && Array.isArray(data)) {
    const now = Date.now()
    for (const item of data) {
      // 跳过已过期的 session
      const elapsedMinutes = (now - item.createdAt) / 1000 / 60
      if (elapsedMinutes >= item.ttlMinutes) {
        continue
      }
      entries.set(item.site, {
        site: item.site,
        sessionId: item.sessionId,
        createdAt: item.createdAt,
        ttlMinutes: item.ttlMinutes
      })
    }
  }
  return entries
}

// ========== 类型定义 ==========

interface SessionEntry {
  /** 站点标识 */
  site: string
  /** FlareSolverr session ID */
  sessionId: string
  /** 创建时间戳 (ms) */
  createdAt: number
  /** TTL 分钟数 */
  ttlMinutes: number
}

interface PendingWaiter {
  resolve: () => void
  reject: (err: Error) => void
}

// ========== SessionPool ==========

/**
 * SessionPool — 会话池
 *
 * 职责：
 * 1. 按 site 隔离 session
 * 2. 并发锁：同一 site 同一时间只有一个请求使用 session
 * 3. TTL 自动轮换：到期前 1 分钟自动 rotate
 * 4. 创建/销毁/健康检查 统一管理
 *
 * 使用方式：
 *   const pool = SessionPool.getInstance()
 *   const sessionId = await pool.acquire('javdb')
 *   try {
 *     // 使用 sessionId 发起请求
 *   } finally {
 *     pool.release('javdb')
 *   }
 */
export class SessionPool {
  private static instance: SessionPool

  /** 会话条目: site -> SessionEntry */
  private entries = new Map<string, SessionEntry>()

  /** 并发锁（复用 LockPool 的 key 跟踪） */
  private lockPool = new LockPool()

  /** 等待队列: site -> PendingWaiter[] */
  private pendingQueue = new Map<string, PendingWaiter[]>()

  /** 默认 TTL（分钟） */
  private defaultTtlMinutes: number

  private constructor(defaultTtlMinutes: number = DEFAULT_SESSION_TTL_MINUTES) {
    this.defaultTtlMinutes = defaultTtlMinutes
    // 从油猴存储中恢复持久化的 session
    this.entries = loadPersistedSessions()
    if (this.entries.size > 0) {
      console.log(`[SessionPool] 从存储中恢复了 ${this.entries.size} 个 session`, this.entries)
    }
  }

  /**
   * 获取 SessionPool 单例
   */
  static getInstance(ttlMinutes?: number): SessionPool {
    if (!SessionPool.instance) {
      SessionPool.instance = new SessionPool(ttlMinutes)
    }
    return SessionPool.instance
  }

  // ========== 公开 API ==========

  /**
   * 获取一个 session（加锁）
   * - 如果已有有效 session，直接返回
   * - 如果 session 过期/不存在，自动创建新 session
   * - 如果 session 被其他请求占用，排队等待
   */
  async acquire(site: string): Promise<string> {
    // 1. 等待锁
    await this.waitForLock(site)

    // 2. 检查现有 session 是否需要轮换
    await this.ensureValidSession(site)

    const entry = this.entries.get(site)
    if (!entry) {
      throw new Error(`SessionPool: ${site} acquire 后仍无 session`)
    }

    // 打印 session 过期时间
    const elapsedMinutes = (Date.now() - entry.createdAt) / 1000 / 60
    const remainingMinutes = Math.max(0, entry.ttlMinutes - elapsedMinutes).toFixed(1)
    console.log(`[SessionPool] ${site} session=${entry.sessionId.slice(0, 8)}… 剩余 ${remainingMinutes} 分钟`)

    return entry.sessionId
  }

  /**
   * 释放 session 锁
   * 必须在 acquire 后的 finally 块中调用
   */
  release(site: string): void {
    this.lockPool.unlock(site)
    this.flushPending(site)
  }

  /**
   * 强制轮换 session：销毁旧的 → 创建新的
   */
  async rotate(site: string): Promise<string> {
    const oldEntry = this.entries.get(site)
    if (oldEntry) {
      await destroySession(oldEntry.sessionId).catch(() => {})
    }
    this.entries.delete(site)

    const sessionId = await createSession('', this.defaultTtlMinutes)
    this.entries.set(site, {
      site,
      sessionId,
      createdAt: Date.now(),
      ttlMinutes: this.defaultTtlMinutes
    })
    persistSessions(this.entries)
    return sessionId
  }

  /**
   * 销毁站点 session 并清理记录
   */
  async destroy(site: string): Promise<void> {
    const entry = this.entries.get(site)
    if (entry) {
      await destroySession(entry.sessionId).catch(() => {})
      this.entries.delete(site)
      persistSessions(this.entries)
    }
  }

  /**
   * 使用 session 执行请求（封装 acquire + release + withRetry）
   * @param site 站点标识
   * @param url 目标 URL
   * @param cookies 携带的 cookies
   * @returns Solution 和实际使用的 sessionId
   */
  async request(
    site: string,
    url: string,
    cookies: GmCallbackCookie[]
  ): Promise<{ solution: Solution; sessionId: string }> {
    const sessionId = await this.acquire(site)
    try {
      const result = await withRetry(
        (sid) => getFromFlareSolverr(url, sid, cookies, this.defaultTtlMinutes),
        sessionId,
        // 重试时创建新 session 的回调
        async () => {
          const newId = await createSession('', this.defaultTtlMinutes)
          this.entries.set(site, {
            site,
            sessionId: newId,
            createdAt: Date.now(),
            ttlMinutes: this.defaultTtlMinutes
          })
          persistSessions(this.entries)
          return newId
        },
        // 重试时销毁旧 session 的回调
        async (sid: string) => {
          await destroySession(sid).catch(() => {})
          // 如果销毁的是当前记录的 session，清理记录
          const entry = this.entries.get(site)
          if (entry && entry.sessionId === sid) {
            this.entries.delete(site)
            persistSessions(this.entries)
          }
        }
      )
      return result
    } finally {
      this.release(site)
    }
  }

  /**
   * 获取当前活跃 session 快照
   */
  getActiveSessions(): Array<{ site: string; sessionId: string; remainingTtlMinutes: number }> {
    const result: Array<{ site: string; sessionId: string; remainingTtlMinutes: number }> = []
    const now = Date.now()
    for (const [site, entry] of this.entries) {
      const elapsed = (now - entry.createdAt) / 1000 / 60
      const remainingTtlMinutes = Math.max(0, entry.ttlMinutes - elapsed)
      result.push({ site, sessionId: entry.sessionId, remainingTtlMinutes })
    }
    return result
  }

  // ========== 内部方法 ==========

  /**
   * 等待锁释放
   */
  private waitForLock(site: string): Promise<void> {
    if (!this.lockPool.locked(site)) {
      this.lockPool.lock(site)
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const queue = this.pendingQueue.get(site) || []
      queue.push({ resolve, reject })
      this.pendingQueue.set(site, queue)
    })
  }

  /**
   * 唤醒等待队列中的下一个
   */
  private flushPending(site: string): void {
    const queue = this.pendingQueue.get(site)
    if (queue && queue.length > 0) {
      const next = queue.shift()!
      if (queue.length === 0) {
        this.pendingQueue.delete(site)
      } else {
        this.pendingQueue.set(site, queue)
      }
      this.lockPool.lock(site)
      next.resolve()
    }
  }

  /**
   * 确保站点有有效的 session
   * - 无 session → 创建
   * - session 过期 → 轮换
   * - session 即将过期（剩余 < 1 分钟）→ 轮换
   */
  private async ensureValidSession(site: string): Promise<void> {
    const entry = this.entries.get(site)

    // 无 session → 创建
    if (!entry) {
      const sessionId = await createSession('', this.defaultTtlMinutes)
      this.entries.set(site, {
        site,
        sessionId,
        createdAt: Date.now(),
        ttlMinutes: this.defaultTtlMinutes
      })
      persistSessions(this.entries)
      return
    }

    // 检查是否过期或即将过期
    const elapsedMinutes = (Date.now() - entry.createdAt) / 1000 / 60
    const remainingMinutes = entry.ttlMinutes - elapsedMinutes

    // 已过期或剩余不足 1 分钟 → 轮换
    if (remainingMinutes <= 1) {
      console.log(`SessionPool: ${site} session 即将过期 (剩余 ${remainingMinutes.toFixed(1)} 分钟)，轮换`)
      await this.rotate(site)
      return
    }

    // 健康检查（仅当剩余时间在安全范围内）
    if (remainingMinutes > 1 && remainingMinutes < 5) {
      const alive = await ensureSessionAlive(entry.sessionId)
      if (!alive) {
        console.warn(`SessionPool: ${site} session 已失效，重建`)
        await this.rotate(site)
      }
    }
  }
}
