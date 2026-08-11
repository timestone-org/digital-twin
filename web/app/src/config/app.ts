/**
 * @fileoverview 应用级常量与后端前缀。地址一律相对路径，由边缘同域反代。
 */

/** auth-server 的对外前缀，与 server/services/auth-server 的 API_PREFIX 同值。 */
export const AUTH_BASE_URL = '/api/v1/auth'

/** platform-server 的对外前缀，与该服务的 API_PREFIX 同值。 */
export const PLATFORM_BASE_URL = '/api/v1/platform'

export const appConfig = {
  name: '数字孪生平台',
  shortName: 'DIGITAL TWIN',
  tagline: '实时感知 · 虚实映射',
} as const

/** access token 到期前提前刷新的余量（秒）。 */
export const REFRESH_SKEW_S = 60

/** setTimeout 的单次最大延时（约 24.8 天）；超过会立刻触发，必须夹住。 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** 请求超时。下游之和必须小于上游，见 docs/agents/runtime-resilience.md §3。 */
export const REQUEST_TIMEOUT_MS = 20_000
