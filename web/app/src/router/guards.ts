/**
 * @fileoverview 路由守卫：未登录跳登录页、权限不足跳 403、已登录不再回登录页。
 */

import type { Router } from 'vue-router'
import { isAllowed, isTokenExpired } from '@dt/security'

import { REFRESH_SKEW_S } from '@/config/app'
import { setUnauthorizedRedirect, useAuthStore } from '@/stores/auth'

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

export function installAuthGuard(router: Router): void {
  setUnauthorizedRedirect(() => {
    void router.replace({
      name: 'login',
      query: { returnUrl: router.currentRoute.value.fullPath },
    })
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (to.meta.anonymous) {
      // 已登录还去登录页：直接回落地页，避免「登录后又看到登录页」
      if (to.name === 'login' && auth.isAuthenticated) {
        return safeReturnTarget(to.query.returnUrl)
      }
      return true
    }

    if (!auth.isAuthenticated) {
      return { name: 'login', query: { returnUrl: to.fullPath } }
    }

    // 令牌已过期：先换一次再放行，换不到才跳登录
    if (isTokenExpired(auth.accessToken, REFRESH_SKEW_S)) {
      const refreshed = await auth.refresh()
      if (!refreshed) {
        return { name: 'login', query: { returnUrl: to.fullPath } }
      }
    }

    const required = to.meta.permissions ?? []
    if (!isAllowed(auth.permissions, required, to.meta.permissionMode)) {
      return { name: 'forbidden' }
    }
    return true
  })

  router.afterEach((to) => {
    const title = to.meta.title
    document.title = title ? `${title} · 数字孪生平台` : '数字孪生平台'
  })
}
