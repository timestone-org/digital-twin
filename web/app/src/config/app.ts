/**
 * @fileoverview 应用级常量与后端前缀。地址一律相对路径，由边缘同域反代。
 */

/** auth-server 的对外前缀，与 server/services/auth-server 的 API_PREFIX 同值。 */
export const AUTH_BASE_URL = '/api/v1/auth'

/** platform-server 的对外前缀，与该服务的 API_PREFIX 同值。 */
export const PLATFORM_BASE_URL = '/api/v1/platform'

/** opcua-server 的对外前缀，与 server/services/opcua-server 的 API_PREFIX 同值。 */
export const OPCUA_BASE_URL = '/api/v1/opcua'

/**
 * 素材字节的取回与直传前缀，由边缘反代到对象存储的桶根。
 * ⚠ 与 platform-server 的 `PLATFORM_OBJECTSTORE_PUBLIC_BASE` 以及 nginx 那条
 * `location ^~ /oss/` 是同一个值：三处分叉的表现是上传 404、模型加载不出来，
 * 而三处的配置单看都对。
 */
export const ASSET_BASE_URL = '/oss/'

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
