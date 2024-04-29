export class LockPool {
  private keyPool = new Set<string>()

  lock(key: string) {
    this.keyPool.add(key)
  }

  unlock(key: string) {
    this.keyPool.delete(key)
  }

  locked(key: string) {
    return this.keyPool.has(key)
  }
}
