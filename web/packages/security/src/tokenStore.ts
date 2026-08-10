/**
 * @fileoverview 登录态的持久化读写。
 * ⚠ 所有访问都要容错：隐私模式与配额满时 localStorage 会抛，
 * 抛出去会让整个应用在启动的第一行就白屏。
 */

export const STORAGE_KEYS = {
  accessToken: 'dt.auth.access_token',
  refreshToken: 'dt.auth.refresh_token',
  user: 'dt.auth.user',
} as const

/** 读一个键；存储不可用时返回 null。 */
export function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 写一个键；存储不可用时静默跳过（登录态退化成会话内有效）。 */
export function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式或配额满：本次会话内仍可用，只是不持久 */
  }
}

/** 删一个键。 */
export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 同上 */
  }
}

/** 登录态占用的键，跨标签同步只关心这几个。 */
const SESSION_KEYS: readonly string[] = [
  STORAGE_KEYS.accessToken,
  STORAGE_KEYS.refreshToken,
  STORAGE_KEYS.user,
]

/**
 * 订阅**别的标签**对登录态的改动，返回退订函数。
 * ⚠ `storage` 事件只在其他标签触发，自己写自己收不到；事件里的 `newValue` 可能
 * 已经过时，所以回调不带载荷——一律重新读存储。
 * @param handler 登录态可能变了的通知
 */
export function subscribeSessionChange(handler: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    // key 为 null 表示别的标签调了 clear()
    if (event.key !== null && !SESSION_KEYS.includes(event.key)) return
    handler()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('storage', onStorage)
  }
}

/** 解析一个 JSON 值；内容损坏时返回 null 而不是抛。 */
export function readJson<T>(key: string): T | null {
  const raw = readItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
