/**
 * @fileoverview 取数 provider 的**类型**面，实现全部归 `@dt/datasources`。
 * ⚠ 类型定在 L0、provider 由应用壳注入，这正是 `@dt/runtime` 不许依赖
 * `@dt/datasources` 的原因（依赖表见 docs/agents/project-structure-typescript.md §2）。
 * ⚠ `PointSample` 是**按 `state` 判别的联合**而不是「必填三件套 + 可选 state」：
 * publisher 的 error 档条目根本不带 `value` / `timestampMs` / `quality`
 * （platform-server `services/publish_items.py`），做成可选字段的话，
 * 取不到的点位会带着 `undefined` 值流进渲染层，而那与「现场报了空值」长得一样。
 */
import type {
  BindingSourceKind,
  HistoryPoint,
  HistoryTimeRange,
} from './binding'

/** 协议无关的三档质量位，驱动负责把协议状态码映射进来。 */
export const POINT_QUALITIES = ['good', 'uncertain', 'bad'] as const
export type PointQuality = (typeof POINT_QUALITIES)[number]

/**
 * 一次读数的三档结论，与 publisher 推送条目的 `state` 逐字一致。
 * `ok` 现值、`stale` 值太旧、`error` 取不到。
 */
export const POINT_STATES = ['ok', 'stale', 'error'] as const
export type PointState = (typeof POINT_STATES)[number]

/**
 * 取到了值的一次读数。
 * ⚠ `stale` 档的 `timestampMs` 是**旧值**的时刻，不许用当前墙钟顶替——
 * 顶替之后陈旧值在界面上与新值完全一样（runtime-resilience §9）。
 */
export interface PointReadingSample {
  state: 'ok' | 'stale'
  /** ⚠ `0` / `false` / `''` 都是合法读数，不许当成「还没有值」。 */
  value: unknown
  /** 采样时刻，UTC 毫秒。 */
  timestampMs: number
  quality: PointQuality
}

/** 取不到，且说得出为什么。 */
export interface PointErrorSample {
  state: 'error'
  errorMessage: string
}

/** 一个点位的一次读数。 */
export type PointSample = PointReadingSample | PointErrorSample

/**
 * 退订。
 * ⚠ 必须在卸载时调用：大屏一开就是几天，漏掉一次就持续累积一份订阅。
 */
export type Unsubscribe = () => void

/** 每收到一个新值调用一次。 */
export type PointValueListener = (nodeKey: string, sample: PointSample) => void

/** 一次历史取数。 */
export interface HistoryQuery {
  /** 点位身份 `{sourceId}:{pointCode}`。 */
  nodeKey: string
  range: HistoryTimeRange
}

/** 历史取数的结果。 */
export interface HistoryResult {
  /** 按时刻升序。 */
  points: HistoryPoint[]
  /** 触顶：窗内还有更多点，只返回了 `limit` 条。 */
  isTruncated: boolean
  /** 数据来自降级路径（缓存、上一次成功的结果）。陈旧必须标注为陈旧。 */
  isStale: boolean
}

/**
 * 一种取数方式的实现面。
 * ⚠ 取不到就说取不到：`readHistory` 失败必须 reject，
 * 绝不返回空 `points` 冒充「这段时间没数据」（DASHBOARD_DESIGN §4.3）。
 */
export interface DataSourceProvider {
  /** 认哪种来源，与 `BindingPayload.sourceKind` 同一套取值。 */
  readonly kind: BindingSourceKind
  /**
   * 订阅一批点位的实时值。
   * @param nodeKeys 要订阅的点位身份
   * @param onValue 每个新值的回调
   */
  subscribe(
    nodeKeys: readonly string[],
    onValue: PointValueListener,
  ): Unsubscribe
  /**
   * 读一段历史序列。
   * @param query 点位与时间范围
   */
  readHistory(query: HistoryQuery): Promise<HistoryResult>
}

/**
 * provider 注册表。应用壳在启动时装配好再注入运行时，
 * 「新增一种取数方式」因此不必碰渲染层。
 */
export interface ProviderRegistry {
  /** 登记一个 provider；同 `kind` 重复登记后者覆盖前者。 */
  register(provider: DataSourceProvider): void
  /** 按来源种类取 provider；没登记过返回 undefined。 */
  get(kind: BindingSourceKind): DataSourceProvider | undefined
  /** 清空。⚠ 只给测试用：生产路径调用它等于把大屏的取数全部摘掉。 */
  reset(): void
}
