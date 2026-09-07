/**
 * @fileoverview 路由守卫：普通登录/权限门禁，以及 API Key 嵌入首航与续航门禁。
 */

import type {
  LocationQuery,
  LocationQueryRaw,
  RouteLocationNormalized,
  RouteLocationRaw,
  Router,
} from 'vue-router'
import { isAllowed, isTokenExpired } from '@dt/security'

import { REFRESH_SKEW_S } from '@/config/app'
import {
  activateEmbed,
  EMBED_MARKER_QUERY,
  EMBED_MARKER_VALUE,
  EMBED_RELOAD_ERROR,
  EMBED_THEME_QUERY,
  EMBED_TOKEN_QUERY,
  normalizeEmbedTheme,
  showEmbedError,
  useEmbedContext,
} from '@/features/embed/context'
import { setUnauthorizedRedirect, useAuthStore } from '@/stores/auth'

const EMBED_UNSUPPORTED_ERROR = '当前页面不支持嵌入，请在数字孪生平台中直接打开'
const EMBED_INVALID_TOKEN_ERROR = '嵌入地址中的 API Key 格式不正确'
const EMBED_PERMISSION_ERROR = 'API Key 对应用户没有访问此页面所需的权限'

const EMBED_EXCLUDED_ROUTES = new Set([
  'login',
  'public-dashboard',
  'profile',
  'forbidden',
  'not-found',
])

declare module 'vue-router' {
  interface RouteMeta {
    /** 匿名可达。缺省即要求登录。 */
    anonymous?: boolean
    /** 进入该路由所需的权限码。 */
    permissions?: readonly string[]
    /** 多码时的判定模式，默认 `all`。 */
    permissionMode?: 'all' | 'any'
    title?: string
  }
}

/** 只允许站内相对路径回跳，防开放重定向。 */
export function safeReturnTarget(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '/'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

function singleQueryValue(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null
}

function hasQuery(query: LocationQuery, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(query, key)
}

/** 登录、安全管理与错误页不接受 API Key 派生的嵌入会话。 */
export function isEmbeddableRoute(to: RouteLocationNormalized): boolean {
  if (to.path === '/profile' || to.path.startsWith('/system/')) return false
  if (to.meta.anonymous) return false
  return !EMBED_EXCLUDED_ROUTES.has(String(to.name ?? ''))
}

function cleanedEmbedLocation(
  to: RouteLocationNormalized,
  themeId: string,
): { path: string; query: LocationQueryRaw; hash: string; replace: true } {
  const query: LocationQueryRaw = { ...to.query }
  delete query[EMBED_TOKEN_QUERY]
  query[EMBED_MARKER_QUERY] = EMBED_MARKER_VALUE
  query[EMBED_THEME_QUERY] = themeId
  return { path: to.path, query, hash: to.hash, replace: true }
}

type AuthStore = ReturnType<typeof useAuthStore>
type EmbedContext = ReturnType<typeof useEmbedContext>
type GuardResult = true | RouteLocationRaw

interface EmbedQueryState {
  hasToken: boolean
}

interface PendingEmbedExchange {
  generation: number
  result: Promise<boolean>
}

interface EmbedNavigationState {
  generation: number
  pending: PendingEmbedExchange | null
}

/** 首先标记模式，保证随后创建的 auth store 不会读取普通 localStorage 会话。 */
function prepareEmbedQuery(
  to: RouteLocationNormalized,
  embed: EmbedContext,
): EmbedQueryState {
  const hasToken = hasQuery(to.query, EMBED_TOKEN_QUERY)
  const hasMarker =
    singleQueryValue(to.query[EMBED_MARKER_QUERY]) === EMBED_MARKER_VALUE
  if (hasToken) activateEmbed(singleQueryValue(to.query[EMBED_THEME_QUERY]))
  if (hasMarker && !embed.isEmbedded.value) {
    activateEmbed(singleQueryValue(to.query[EMBED_THEME_QUERY]))
    showEmbedError(EMBED_RELOAD_ERROR)
  }
  return { hasToken }
}

function startEmbedFromQuery(
  to: RouteLocationNormalized,
  auth: AuthStore,
  embed: EmbedContext,
  navigation: EmbedNavigationState,
): RouteLocationRaw {
  const apiKey = singleQueryValue(to.query[EMBED_TOKEN_QUERY])
  const generation = navigation.generation + 1
  navigation.generation = generation
  navigation.pending = null
  if (!isEmbeddableRoute(to)) {
    auth.clear()
    showEmbedError(EMBED_UNSUPPORTED_ERROR)
  } else if (apiKey === null || !apiKey.startsWith('dtk_')) {
    auth.clear()
    showEmbedError(EMBED_INVALID_TOKEN_ERROR)
  } else {
    navigation.pending = {
      generation,
      result: auth.startEmbedSession(
        apiKey,
        singleQueryValue(to.query[EMBED_THEME_QUERY]),
      ),
    }
  }
  const cleaned = cleanedEmbedLocation(
    to,
    embed.themeId.value ?? normalizeEmbedTheme(null),
  )
  persistEmbedAddress(embed, to.fullPath)
  return cleaned
}

async function awaitPendingEmbedExchange(
  navigation: EmbedNavigationState,
): Promise<void> {
  for (;;) {
    const pending = navigation.pending
    if (pending === null) return
    await pending.result
    if (navigation.pending?.generation !== pending.generation) continue
    navigation.pending = null
    return
  }
}

async function guardEmbeddedRoute(
  to: RouteLocationNormalized,
  auth: AuthStore,
  embed: EmbedContext,
  navigation: EmbedNavigationState,
): Promise<GuardResult> {
  await awaitPendingEmbedExchange(navigation)
  if (!isEmbeddableRoute(to)) showEmbedError(EMBED_UNSUPPORTED_ERROR)
  if (embed.error.value !== null) return true
  if (!auth.isAuthenticated) {
    showEmbedError(EMBED_RELOAD_ERROR)
    return true
  }
  if (
    isTokenExpired(auth.accessToken, REFRESH_SKEW_S) &&
    !(await auth.refresh())
  ) {
    return true
  }
  const required = to.meta.permissions ?? []
  if (!isAllowed(auth.permissions, required, to.meta.permissionMode)) {
    showEmbedError(EMBED_PERMISSION_ERROR)
  }
  return true
}

async function guardEmbedMode(
  to: RouteLocationNormalized,
  auth: AuthStore,
  embed: EmbedContext,
  query: EmbedQueryState,
  navigation: EmbedNavigationState,
): Promise<GuardResult | null> {
  if (query.hasToken) return startEmbedFromQuery(to, auth, embed, navigation)
  if (!embed.isEmbedded.value) return null
  return await guardEmbeddedRoute(to, auth, embed, navigation)
}

function persistEmbedAddress(
  embed: EmbedContext,
  address = window.location.href,
): void {
  if (!embed.isEmbedded.value) return
  const themeId = embed.themeId.value ?? normalizeEmbedTheme(null)
  const url = new URL(address, window.location.origin)
  if (
    !url.searchParams.has(EMBED_TOKEN_QUERY) &&
    url.searchParams.get(EMBED_MARKER_QUERY) === EMBED_MARKER_VALUE &&
    url.searchParams.get(EMBED_THEME_QUERY) === themeId
  ) {
    return
  }
  url.searchParams.delete(EMBED_TOKEN_QUERY)
  url.searchParams.set(EMBED_MARKER_QUERY, EMBED_MARKER_VALUE)
  url.searchParams.set(EMBED_THEME_QUERY, themeId)
  const target = `${url.pathname}${url.search}${url.hash}`
  const state: unknown = window.history.state
  window.history.replaceState(state, '', target)
}

async function guardBrowserRoute(
  to: RouteLocationNormalized,
  auth: AuthStore,
): Promise<GuardResult> {
  if (to.meta.anonymous) {
    if (to.name === 'login' && auth.isAuthenticated) {
      return safeReturnTarget(to.query.returnUrl)
    }
    return true
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { returnUrl: to.fullPath } }
  }
  if (
    isTokenExpired(auth.accessToken, REFRESH_SKEW_S) &&
    !(await auth.refresh())
  ) {
    return { name: 'login', query: { returnUrl: to.fullPath } }
  }
  const required = to.meta.permissions ?? []
  return isAllowed(auth.permissions, required, to.meta.permissionMode)
    ? true
    : { name: 'forbidden' }
}

export function installAuthGuard(router: Router): void {
  const embedNavigation: EmbedNavigationState = {
    generation: 0,
    pending: null,
  }
  setUnauthorizedRedirect(() => {
    void router.replace({
      name: 'login',
      query: { returnUrl: router.currentRoute.value.fullPath },
    })
  })

  router.beforeEach(async (to) => {
    const embed = useEmbedContext()
    const query = prepareEmbedQuery(to, embed)
    const auth = useAuthStore()
    const embedResult = await guardEmbedMode(
      to,
      auth,
      embed,
      query,
      embedNavigation,
    )
    return embedResult ?? (await guardBrowserRoute(to, auth))
  })

  router.afterEach((to, _from, failure) => {
    if (failure === undefined) persistEmbedAddress(useEmbedContext())
    const title = to.meta.title
    document.title = title ? `${title} · 数字孪生平台` : '数字孪生平台'
  })
}
