/**
 * @fileoverview 后端统一响应信封与错误码。口径见 docs/agents/api-contract.md §3–§4。
 */

/** 所有响应体的唯一形状。204 无 body 时不适用。 */
export interface ApiEnvelope<TData> {
  code: number
  message: string
  data: TData | null
  trace_id: string
  details?: FieldError[]
}

/** 字段级校验错误。`field` 是点号与方括号表达的嵌套路径。 */
export interface FieldError {
  field: string
  code: string
  message: string
}

/** 页码分页的集合响应。 */
export interface Page<TItem> {
  items: TItem[]
  page: number
  size: number
  total: number
}

export const SUCCESS_CODE = 0

/**
 * 已发布的错误码。**按码分支，不要按 message 分支**——文案会改、会翻译。
 * 分段十进制 `<4|5><领域两位><序号两位>`，领域 00 通用、01 认证与授权。
 */
export const ERROR_CODES = {
  validationFailed: 40001,
  rateLimited: 40002,
  notFound: 40003,
  conflict: 40004,
  unauthenticated: 40100,
  invalidCredentials: 40101,
  tokenInvalid: 40102,
  refreshRejected: 40103,
  accountDisabled: 40104,
  serviceKeyInvalid: 40105,
  permissionRequired: 40106,
  grantExceedsOperator: 40107,
  targetHigherPrivileged: 40108,
  selfLockout: 40109,
  builtinImmutable: 40110,
  tooManyLoginAttempts: 40111,
  signupDisabled: 40112,
  internal: 50000,
  dependencyUnavailable: 50001,
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
