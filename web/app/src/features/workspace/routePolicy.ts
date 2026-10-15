/** @fileoverview 工作页签与编辑器缓存的路由范围。 */
import type { RouteLocationNormalized } from 'vue-router'

const CACHED_PAGES = new Set([
  'dashboard-editor',
  'twin-editor',
  'twin-2d-editor',
  'card-editor',
  'modeling-canvas',
  'report-editor',
])
const STANDALONE_PAGES = new Set([
  'login',
  'forbidden',
  'not-found',
  'dashboard-view',
])

export function isWorkspaceRoute(route: RouteLocationNormalized): boolean {
  return (
    route.matched.length > 0 &&
    route.meta.anonymous !== true &&
    !STANDALONE_PAGES.has(String(route.name))
  )
}

export function shouldCacheRoute(route: RouteLocationNormalized): boolean {
  return CACHED_PAGES.has(String(route.name))
}
