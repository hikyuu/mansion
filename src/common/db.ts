import type { SupabaseClient } from '@supabase/supabase-js'
import { useUserStore } from '@/store/user-store'

/** 统一的数据访问错误：调用方只关心 message，不再各自解包 PostgrestError */
export class DbError extends Error {
  override readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DbError'
    this.cause = cause
  }
}

export interface DbResult<T> {
  data: T | null
  error: unknown
}

export type DbRun<T> = (db: SupabaseClient) => PromiseLike<DbResult<T>>

/** 写操作的重试次数：总尝试次数 = retries + 1，与迁移前「重试 3 次」一致 */
export const WRITE_RETRIES = 3

function toDbError(error: unknown): DbError {
  if (error instanceof DbError) return error
  if (error instanceof Error) return new DbError(error.message || '数据库请求失败', error)
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message)
    return new DbError(message || '数据库请求失败', error)
  }
  return new DbError(typeof error === 'string' && error ? error : '数据库请求失败', error)
}

/** 读：统一鉴权与错误归一，失败抛 DbError */
export async function read<T>(run: DbRun<T>): Promise<T | null> {
  const db = await useUserStore().getAuthSupabase()
  const { data, error } = await run(db)
  if (error) throw toDbError(error)
  return data
}

/** 写：鉴权 + 立即重试（无退避，与迁移前一致），耗尽后抛 DbError */
export async function write<T>(run: DbRun<T>, retries: number = WRITE_RETRIES): Promise<T | null> {
  const db = await useUserStore().getAuthSupabase()
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await run(db)
    if (!error) return data
    lastError = error
  }
  throw toDbError(lastError)
}
