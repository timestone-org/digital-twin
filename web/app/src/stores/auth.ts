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
import {
  activateEmbed,
  clearEmbedError,
  showEmbedError,
  useEmbedContext,
} from '@/features/embed/context'

/** 未授权时的跳转动作，由 router 注入一次。 */
let redirectToLogin: (() => void) | null = null

/** 页面级监听只该有一份；store 会随 pinia 重建，旧的必须先摘掉。 */
let detachPageListeners: (() => void) | null = null

export function setUnauthorizedRedirect(fn: () => void): void {
  redirectToLogin = fn
}

export const useAuthStore = defineStore('auth', () => {
  const embed = useEmbedContext()
  // ⚠ 嵌入首航在创建 store 前已由守卫标记。此分支必须惰性：哪怕同源浏览器里
  // 正登录着另一个账号，iframe 也一个 storage 键都不读，身份只能来自 API Key。
  const accessToken = ref<string | null>(
    embed.isEmbedded.value ? null : readItem(STORAGE_KEYS.accessToken),
  )
  const refreshToken = ref<string | null>(
    embed.isEmbedded.value ? null : readItem(STORAGE_KEYS.refreshToken),
  )
  const user = ref<AuthUser | null>(
    embed.isEmbedded.value ? null : readJson<AuthUser>(STORAGE_KEYS.user),
  )

  const isAuthenticated = computed(() => accessToken.value !== null)
  const permissions = computed(() => new Set(user.value?.permissions ?? []))
  const displayName = computed(
    () => user.value?.full_name || user.value?.username || '',
  )

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let inFlightRefresh: Promise<boolean> | null = null
  let embedApiKey: string | null = null
  let embedExpiresAtMs: number | null = null
  // 模式切换与新一轮嵌入首航都会递增；旧请求晚回来只能丢弃，不能覆盖新身份。
  let sessionGeneration = 0

  function cancelScheduledRefresh(): void {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  /** 依据普通 token 的 exp 或嵌入交换回执安排下一次主动刷新。 */
  function scheduleRefresh(): void {
    cancelScheduledRefresh()
    const token = accessToken.value
    if (token === null) return
    const expiry = embed.isEmbedded.value
      ? embedExpiresAtMs === null
        ? null
        : embedExpiresAtMs / 1000
      : readTokenExpiry(token)
    if (!embed.isEmbedded.value && refreshToken.value === null) return
    if (embed.isEmbedded.value && embedApiKey === null) return
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
    if (embed.isEmbedded.value) return
    accessToken.value = result.token.access_token
    refreshToken.value = result.token.refresh_token
    user.value = result.user
    writeItem(STORAGE_KEYS.accessToken, result.token.access_token)
    writeItem(STORAGE_KEYS.refreshToken, result.token.refresh_token)
    writeItem(STORAGE_KEYS.user, JSON.stringify(result.user))
    scheduleRefresh()
  }

  /** 写入一份只活在当前文档里的嵌入会话。 */
  function setEmbedSession(result: authApi.EmbedSessionResult): void {
    accessToken.value = result.token.access_token
    refreshToken.value = null
    user.value = result.user
    embedExpiresAtMs = Date.now() + result.token.expires_in_s * 1000
    clearEmbedError()
    scheduleRefresh()
  }

  /** 把存储里那份登录态搬进内存——别的标签刚写过，那份才是有效的。 */
  function adoptStoredSession(): void {
    if (embed.isEmbedded.value) return
    accessToken.value = readItem(STORAGE_KEYS.accessToken)
    refreshToken.value = readItem(STORAGE_KEYS.refreshToken)
    user.value = readJson<AuthUser>(STORAGE_KEYS.user)
    scheduleRefresh()
  }

  /** 别的标签动过登录态：换了令牌就跟着换，登出了就跟着登出。 */
  function syncFromStorage(): void {
    if (embed.isEmbedded.value) return
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

  function clearMemory(): void {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    embedExpiresAtMs = null
    cancelScheduledRefresh()
  }

  function invalidatePendingSession(): void {
    sessionGeneration += 1
    inFlightRefresh = null
  }

  function clearBrowserSession(): void {
    invalidatePendingSession()
    clearMemory()
    removeItem(STORAGE_KEYS.accessToken)
    removeItem(STORAGE_KEYS.refreshToken)
    removeItem(STORAGE_KEYS.user)
  }

  function clear(): void {
    if (embed.isEmbedded.value) {
      invalidatePendingSession()
      clearMemory()
      embedApiKey = null
      return
    }
    clearBrowserSession()
  }

  async function login(username: string, password: string): Promise<AuthUser> {
    const generation = sessionGeneration
    const result = await authApi.createSession(username, password)
    if (generation === sessionGeneration && !embed.isEmbedded.value) {
      setSession(result)
    }
    return result.user
  }

  function browserSessionWasReplaced(generation: number): boolean {
    return generation !== sessionGeneration || embed.isEmbedded.value
  }

  /** 换一对新令牌。**只允许在跨标签锁内调用**。 */
  async function rotate(): Promise<boolean> {
    if (embed.isEmbedded.value) return false
    const generation = sessionGeneration
    const stored = readItem(STORAGE_KEYS.refreshToken)
    // 排队等锁期间别的标签已经换过：手里这枚早被拉黑了，直接用新的
    if (stored !== null && stored !== refreshToken.value) {
      adoptStoredSession()
      return accessToken.value !== null
    }
    const token = refreshToken.value
    if (token === null) return false
    try {
      const result = await authApi.refreshSession(token)
      if (browserSessionWasReplaced(generation)) return false
      setSession(result)
      return true
    } catch {
      if (browserSessionWasReplaced(generation)) return false
      // 没有 Web Locks 的浏览器仍可能撞车：对方已写回新令牌就跟着用，别把人踢下线
      if (readItem(STORAGE_KEYS.refreshToken) !== token) {
        adoptStoredSession()
        return accessToken.value !== null
      }
      clearBrowserSession()
      return false
    }
  }

  function failEmbedSession(isRenewal: boolean): false {
    clearMemory()
    showEmbedError(
      isRenewal
        ? '嵌入授权已失效，请由宿主页面重新加载此内容'
        : '嵌入授权建立失败，请检查 API Key 是否有效且有权访问此页面',
    )
    return false
  }

  /** API Key 始终只从闭包读取，交换结果也不写任何 storage。 */
  async function exchangeEmbedSession(
    isRenewal: boolean,
    generation: number,
  ): Promise<boolean> {
    const apiKey = embedApiKey
    if (apiKey === null) return failEmbedSession(isRenewal)
    try {
      const result = await authApi.createSessionFromApiKey(apiKey)
      if (
        generation !== sessionGeneration ||
        embedApiKey !== apiKey ||
        !embed.isEmbedded.value
      ) {
        return false
      }
      setEmbedSession(result)
      return true
    } catch {
      if (generation !== sessionGeneration || embedApiKey !== apiKey)
        return false
      return failEmbedSession(isRenewal)
    }
  }

  async function startEmbedSession(
    apiKey: string,
    theme: unknown,
  ): Promise<boolean> {
    activateEmbed(theme)
    sessionGeneration += 1
    inFlightRefresh = null
    clearMemory()
    embedApiKey = apiKey
    return await exchangeEmbedSession(false, sessionGeneration)
  }

  /** single-flight：标签内合并并发，标签间由锁串行。 */
  function refresh(): Promise<boolean> {
    if (inFlightRefresh !== null) return inFlightRefresh
    const running = embed.isEmbedded.value
      ? exchangeEmbedSession(true, sessionGeneration)
      : withSessionLock(rotate)
    const tracked = running.finally(() => {
      if (inFlightRefresh === tracked) inFlightRefresh = null
    })
    inFlightRefresh = tracked
    return tracked
  }

  /** 对齐权限。失败一律吞掉——这是后台静默对齐，不该把人踢下线。 */
  async function syncMe(): Promise<void> {
    if (embed.isEmbedded.value) return
    if (accessToken.value === null) return
    const generation = sessionGeneration
    try {
      const fresh = await authApi.fetchMe()
      if (generation !== sessionGeneration || embed.isEmbedded.value) return
      user.value = fresh
      writeItem(STORAGE_KEYS.user, JSON.stringify(fresh))
    } catch {
      /* 网络抖动或服务重启：保留现有权限，等下次对齐 */
    }
  }

  async function logout(): Promise<void> {
    if (embed.isEmbedded.value) {
      clear()
      showEmbedError('嵌入会话已结束，请由宿主页面重新加载此内容')
      return
    }
    const token = refreshToken.value
    clearBrowserSession()
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
    if (embed.isEmbedded.value) {
      if (accessToken.value === null) return
      if (isTokenExpired(accessToken.value, REFRESH_SKEW_S)) {
        void refresh()
        return
      }
      scheduleRefresh()
      return
    }
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
    onUnauthorized: (attemptedToken) => {
      if (embed.isEmbedded.value) {
        if (accessToken.value === attemptedToken) failEmbedSession(true)
        return
      }
      if (accessToken.value !== null && accessToken.value !== attemptedToken) {
        return
      }
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
    startEmbedSession,
    syncMe,
    clear,
    scheduleRefresh,
    can,
  }
})
