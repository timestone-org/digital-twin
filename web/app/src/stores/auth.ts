/**
 * @fileoverview auth store —— 登录态（令牌 + 用户）、持久化与跨标签同步。
 *
 * ⚠ 刷新令牌一次性：服务端换出新的就把旧的拉黑，所以轮换要串两道——标签内靠
 * `inFlightRefresh` 合并并发，标签之间靠 `withSessionLock` 排他，且进临界区先
 * 重读存储。少一道就会有标签拿着已作废的那枚去换，被当成重放拒掉后静默登出。
 * ⚠ 定时器在后台标签会被节流到分钟级，回前台时补一次判定，不能只靠 401 兜底。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser } from '@dt/contracts'
import { useToast } from '@dt/ui'
import {
  STORAGE_KEYS,
  readItem,
  readJson,
  removeItem,
  subscribeSessionChange,
  withSessionLock,
  writeItem,
} from '@dt/security'
import { isAllowed, isTokenExpired, readTokenExpiry } from '@dt/security'

import * as authApi from '@/api/auth'
import { configureApiClient } from '@/api/client'
import { MAX_TIMEOUT_MS, REFRESH_SKEW_S } from '@/config/app'

/** 未授权时的跳转动作，由 router 注入一次。 */
let redirectToLogin: (() => void) | null = null

/** 页面级监听只该有一份；store 会随 pinia 重建，旧的必须先摘掉。 */
let detachPageListeners: (() => void) | null = null

export function setUnauthorizedRedirect(fn: () => void): void {
  redirectToLogin = fn
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(readItem(STORAGE_KEYS.accessToken))
  const refreshToken = ref<string | null>(readItem(STORAGE_KEYS.refreshToken))
  const user = ref<AuthUser | null>(readJson<AuthUser>(STORAGE_KEYS.user))

  const isAuthenticated = computed(() => accessToken.value !== null)
  const permissions = computed(() => new Set(user.value?.permissions ?? []))
  const displayName = computed(
    () => user.value?.full_name || user.value?.username || '',
  )

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightRefresh: Promise<boolean> | null = null

  function cancelScheduledRefresh(): void {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  /** 依据 access token 的 exp 安排下一次主动刷新。 */
  function scheduleRefresh(): void {
    cancelScheduledRefresh()
    const token = accessToken.value
    if (token === null || refreshToken.value === null) return
    const expiry = readTokenExpiry(token)
    // 非 JWT 或无 exp：放弃主动刷新，退回被动 401 兜底
    if (expiry === null) return
    const delay = (expiry - REFRESH_SKEW_S) * 1000 - Date.now()
    refreshTimer = setTimeout(
      () => {
        void refresh()
      },
      Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS),
    )
  }

  function setSession(result: authApi.SessionResult): void {
    accessToken.value = result.token.access_token
    refreshToken.value = result.token.refresh_token
    user.value = result.user
    writeItem(STORAGE_KEYS.accessToken, result.token.access_token)
    writeItem(STORAGE_KEYS.refreshToken, result.token.refresh_token)
    writeItem(STORAGE_KEYS.user, JSON.stringify(result.user))
    scheduleRefresh()
  }

  /** 把存储里那份登录态搬进内存——别的标签刚写过，那份才是有效的。 */
  function adoptStoredSession(): void {
    accessToken.value = readItem(STORAGE_KEYS.accessToken)
    refreshToken.value = readItem(STORAGE_KEYS.refreshToken)
    user.value = readJson<AuthUser>(STORAGE_KEYS.user)
    scheduleRefresh()
  }

  /** 别的标签动过登录态：换了令牌就跟着换，登出了就跟着登出。 */
  function syncFromStorage(): void {
    const stored = readItem(STORAGE_KEYS.accessToken)
    if (stored === accessToken.value) {
      // 令牌没变但用户变了：那边 syncMe 对齐过权限，跟上，免得两边闸 3 判得不一样
      const raw = readItem(STORAGE_KEYS.user)
      if (raw !== null && raw !== JSON.stringify(user.value)) {
        user.value = readJson<AuthUser>(STORAGE_KEYS.user)
      }
      return
    }
    if (stored !== null) {
      adoptStoredSession()
      return
    }
    // 那边登出时服务端已经吊销了这条会话，本地再留着只会每个请求都 401
    if (accessToken.value === null) return
    clear()
    useToast().info('已在其他标签页退出登录')
    redirectToLogin?.()
  }

  function clear(): void {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    removeItem(STORAGE_KEYS.accessToken)
    removeItem(STORAGE_KEYS.refreshToken)
    removeItem(STORAGE_KEYS.user)
    cancelScheduledRefresh()
  }

  async function login(username: string, password: string): Promise<AuthUser> {
    const result = await authApi.createSession(username, password)
    setSession(result)
    return result.user
  }

  /** 换一对新令牌。**只允许在跨标签锁内调用**。 */
  async function rotate(): Promise<boolean> {
    const stored = readItem(STORAGE_KEYS.refreshToken)
    // 排队等锁期间别的标签已经换过：手里这枚早被拉黑了，直接用新的
    if (stored !== null && stored !== refreshToken.value) {
      adoptStoredSession()
      return accessToken.value !== null
    }
    const token = refreshToken.value
    if (token === null) return false
    try {
      setSession(await authApi.refreshSession(token))
      return true
    } catch {
      // 没有 Web Locks 的浏览器仍可能撞车：对方已写回新令牌就跟着用，别把人踢下线
      if (readItem(STORAGE_KEYS.refreshToken) !== token) {
        adoptStoredSession()
        return accessToken.value !== null
      }
      clear()
      return false
    }
  }

  /** single-flight：标签内合并并发，标签间由锁串行。 */
  function refresh(): Promise<boolean> {
    inFlightRefresh ??= withSessionLock(rotate).finally(() => {
      inFlightRefresh = null
    })
    return inFlightRefresh
  }

  /** 对齐权限。失败一律吞掉——这是后台静默对齐，不该把人踢下线。 */
  async function syncMe(): Promise<void> {
    if (accessToken.value === null) return
    try {
      const fresh = await authApi.fetchMe()
      user.value = fresh
      writeItem(STORAGE_KEYS.user, JSON.stringify(fresh))
    } catch {
      /* 网络抖动或服务重启：保留现有权限，等下次对齐 */
    }
  }

  async function logout(): Promise<void> {
    const token = refreshToken.value
    clear()
    if (token !== null) {
      try {
        await authApi.revokeSession(token)
      } catch {
        /* 本地已清干净，服务端吊销失败不该阻断登出 */
      }
    }
  }

  /** 闸 3：只决定给不给点，**不是安全边界**，后端仍会拦。 */
  function can(codes: readonly string[], mode: 'all' | 'any' = 'all'): boolean {
    return isAllowed(permissions.value, codes, mode)
  }

  /** 回到前台：先跟上别的标签，再补一次被节流掉的到期判定。 */
  function onPageVisible(): void {
    if (document.visibilityState !== 'visible') return
    syncFromStorage()
    if (accessToken.value === null) return
    if (isTokenExpired(accessToken.value, REFRESH_SKEW_S)) {
      void refresh()
      return
    }
    scheduleRefresh()
  }

  detachPageListeners?.()
  const detachStorage = subscribeSessionChange(syncFromStorage)
  document.addEventListener('visibilitychange', onPageVisible)
  detachPageListeners = () => {
    detachStorage()
    document.removeEventListener('visibilitychange', onPageVisible)
  }

  configureApiClient({
    getToken: () => accessToken.value,
    onRefresh: refresh,
    onUnauthorized: () => {
      // ⚠ 必须说一声：不说的话用户看到的是「点了一下就莫名其妙回到登录页」
      if (accessToken.value !== null) {
        useToast().warning('登录状态已过期，请重新登录')
      }
      clear()
      redirectToLogin?.()
    },
  })

  // 页面重载后内存里的定时器没了，恢复出来的登录态要重新排一次主动刷新
  scheduleRefresh()

  return {
    accessToken,
    refreshToken,
    user,
    isAuthenticated,
    permissions,
    displayName,
    login,
    logout,
    refresh,
    syncMe,
    clear,
    scheduleRefresh,
    can,
  }
})
