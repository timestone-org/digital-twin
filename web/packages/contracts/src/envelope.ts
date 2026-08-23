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

/**
 * 游标分页的集合响应。时序集合用它而不是页码：页码分页会在新数据不断写入时
 * 静默重复或漏行，见 docs/agents/api-contract.md §5。
 */
export interface CursorPage<TItem> {
  items: TItem[]
  /**
   * 下一页的游标。
   * ⚠ 不透明串，**只能原样带回**——解析它就是把后端的分页实现钉死在前端。
   */
  next: string | null
  has_more: boolean
}

export const SUCCESS_CODE = 0

/**
 * 已发布的错误码。**按码分支，不要按 message 分支**——文案会改、会翻译。
 * 分段十进制 `<4|5><领域两位><序号两位>`，领域 00 通用、01 认证与授权、
 * 12 数据台账、16 空调与空间。
 *
 * ⚠ 只登记**前端真的按它分支**的码：登记一个没人消费的码，等于摆出一条
 * 看起来处理过、实际走的是通用兜底的分支。
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
  /** 台账编码已被占用。表单据此把错误落到「编码」那一格上，而不是弹一句通用失败。 */
  datasetTableCodeTaken: 41203,
  /** 同一张台账下已有同名列标识。同上：落到「列标识」那一格，不弹通用失败。 */
  datasetColumnKeyTaken: 41204,
  /** 台账下还有数据行。⚠ 这不是失败，是**升一级再问**：确认后带 force 重发。 */
  datasetTableNotEmpty: 41205,
  /**
   * 还有别的列的公式引用着这一列。⚠ 与上一条分开：那一条问「连历史一起删吗」，
   * 这一条问「那几条公式就此算不出数，仍然删吗」，两句话的后果完全不同。
   */
  datasetColumnInUse: 41206,
  workshopNotFound: 41601,
  roomNotFound: 41602,
  acUnitNotFound: 41603,
  workshopNameTaken: 41604,
  roomNameTaken: 41605,
  acUnitSerialTaken: 41606,
  workshopNotEmpty: 41607,
  roomNotEmpty: 41608,
  datasetNotFound: 41609,
  bindingNotFound: 41610,
  sourceObjectInvalid: 41611,
  sourceObjectShapeMismatch: 41612,
  timeRangeInvalid: 41613,
  metricUnknown: 41614,
  cursorInvalid: 41615,
  startupRebuildInProgress: 41616,
  /** 服务组合与工件对不上（多半是训练之后新加的机组），要重训。 */
  modelConfigInvalid: 41620,
  internal: 50000,
  dependencyUnavailable: 50001,
  /** 外部数据源不可用。⚠ 后端刻意不给陈旧数据兜底，前端也不许显示旧值。 */
  sourceUnavailable: 51601,
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
