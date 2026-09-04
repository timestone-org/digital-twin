/**
 * @fileoverview 取数 provider 的**类型**面，实现全部归 `@dt/datasources`。
 * ⚠ 类型定在 L0、provider 由应用壳注入，这正是 `@dt/runtime` 不许依赖
 * `@dt/datasources` 的原因（依赖表见 docs/agents/project-structure-typescript.md §2）。
 * ⚠ `PointSample` 是**按 `state` 判别的联合**而不是「必填三件套 + 可选 state」：
 * publisher 的 error 档条目根本不带 `value` / `timestampMs` / `quality`
 * （platform-server `apps/collect/services/point_frames.py`），做成可选字段的话，
 * 取不到的点位会带着 `undefined` 值流进渲染层，而那与「现场报了空值」长得一样。
 */
import type {
  BindingDetail,
  BindingSourceKind,
  HistoryPoint,
  HistoryTimeRange,
} from './binding'

/** 协议无关的三档质量位，驱动负责把协议状态码映射进来。 */
export const POINT_QUALITIES = ['good', 'uncertain', 'bad'] as const
export type PointQuality = (typeof POINT_QUALITIES)[number]

/**
 * 一次读数的两档结论，与 publisher 推送条目的 `state` 逐字一致。
 * `ok` 有值、`error` 取不到。
 * ⚠ 没有「值太旧」这一档：订阅只在值变化时回调，一个一天变一次的点位按时刻
 * 判就会每天有 23 小时被降档，而它的值一直是对的。采集停了则整个快照到期，
 * 落进 `error`。
 */
export const POINT_STATES = ['ok', 'error'] as const
export type PointState = (typeof POINT_STATES)[number]

/**
 * 取到了值的一次读数。
 * ⚠ `timestampMs` 是**采样时刻**，不许用当前墙钟顶替——顶替之后，界面上
 * 「更新于」这一列会对每个点位都显示「刚刚」，而它正是判断现场还动不动的
 * 唯一依据（runtime-resilience §9）。
 */
export interface PointReadingSample {
  state: 'ok'
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

/**
 * 一条时序槽要取的那段序列。
 * ⚠ `detail` 是绑定上的取数说明**原文**：判别它是哪一支、拆成哪个端点的参数，
 * 是取数适配器的事。发起取数的那一层只按清单的时序声明挑槽，对来源种类无感知
 * （docs/DASHBOARD_CHART_MODULES_DESIGN.md §4.3 D5）。
 */
export interface SeriesRequest {
  /** 槽键，回填时按它对号入座。 */
  fieldKey: string
  /** 取数说明原文。 */
  detail: BindingDetail
}

/**
 * 一条序列的取数结论。
 * ⚠ 没有「空序列冒充取不到」这一档：取不到一律落 `error`，`ok` 带一个长度为 0
 * 的 `points` 才是「取到了，窗内确实没数据」——两者在屏上要长得不一样。
 */
export type SeriesOutcome =
  | {
      state: 'ok'
      /** 按时刻升序。 */
      points: readonly HistoryPoint[]
      /** 触顶：窗内还有更多点，只取回了上限那一批。 */
      isTruncated: boolean
      /**
       * 触顶砍掉的是哪一头，文案据此写。
       * ⚠ 两个读侧砍的方向相反：点位逐条读是正序取前 N 条、砍掉晚的那一头，
       * 台账序列留的是最新那一批、砍掉早的那一头。写一句通用的「数据被截断」
       * 会让人按错的方向去读那条曲线，而曲线本身完全合法。
       */
      truncatedSide?: 'early' | 'late'
      /** 值来自降级路径。陈旧必须标注为陈旧。 */
      isStale: boolean
    }
  | { state: 'error'; message: string }

/**
 * 一次读一批序列，回表的键是 `SeriesRequest.fieldKey`。
 * ⚠ 收一批不是收一条：同表同窗的多列必须并成一次请求。一块绑了同一张台账 6 列
 * 的模块逐条取数会发 6 次完全一样的请求，配合刷新节拍就是每分钟几十次串行往返；
 * 而两个读侧端点本来就一次收得下几十条。
 * @param requests 这一轮要取的全部序列
 * @param signal 作废在飞的这一次
 */
export type SeriesReader = (
  requests: readonly SeriesRequest[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, SeriesOutcome>>
