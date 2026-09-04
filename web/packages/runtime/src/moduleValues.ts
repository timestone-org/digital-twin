/**
 * @fileoverview 绑定求值：`BindingView[]` → 注入渲染组件的 `values`。**纯函数**，
 * 清单绑定槽与「读一条绑定」的能力都由调用方注入，本文件不查任何注册表、不发任何请求。
 * ⚠ 它也不认识来源种类：派生槽由 `computeJson` 这条**声明**认出来，
 * 加一种来源不必碰这里（docs/DASHBOARD_DESIGN.md §5.5）。
 */
import type {
  BindingView,
  BindingSpec,
  BindingTransform,
  HistoryPoint,
  ModuleSlotMeta,
} from '@dt/contracts'

/**
 * 一条绑定当前的取数结果。
 * ⚠ 没有「空」这一档：取不到就说取不到，空值冒充「这段时间没数据」正是本设计
 * 要消灭的静默故障（DASHBOARD_DESIGN §4.3）。
 */
export type BindingSlot =
  | {
      state: 'ok'
      value: unknown
      /**
       * 采样时刻，UTC 毫秒。
       * ⚠ 带序列的槽一律不写它：它只记进 `tally.sampled`，而那一档推的是
       * 「实时通道断了、屏上还挂着推来的值」。历史序列是一次性拉回来的，
       * 写了会让实时通道一抖就把一屏图表全标成可能过期。时刻在 `points` 里。
       */
      timestampMs?: number
      /**
       * 时序槽的历史序列，按时刻升序。
       * ⚠ 缺席 ≠ 空序列：取不到就让 `state` 落 `error`，缺席时这一格一个点
       * 都不注入。空数组是「取到了，窗内确实没数据」，两者在屏上要长得不一样。
       */
      points?: readonly HistoryPoint[]
      /** 窗内还有更多点，只取回了上限那一批。 */
      isTruncated?: boolean
      /** 值来自降级路径。 */
      isStale?: boolean
    }
  /** 还没有首帧。 */
  | { state: 'pending' }
  /** 取不到，且说得出为什么。 */
  | { state: 'error'; message: string }

/**
 * 读一条绑定当前值的注入口——运行态的取数全部从这里进来。
 * @param binding 要读的绑定
 * @param siblings 同节点内已求值的槽，键是 `fieldKey`，供派生槽运算
 */
export type BindingValueReader = (
  binding: BindingView,
  siblings: Readonly<Record<string, unknown>>,
) => BindingSlot

/** 各档槽的计数。模块状态只看这些数，不看来源种类。 */
export interface ModuleValuesTally {
  /** 配了来源的绑定数。 */
  bound: number
  /** 取到了非空值。 */
  ok: number
  /**
   * 取到了非空值、且带采样时刻的槽数。
   * ⚠ 这不是「哪种来源」——本文件仍对来源无感知：带采样时刻就是「有人在往这条
   * 槽里推值」，通道一断它们就全成了最后已知值，`stale` 一档据此推。
   */
  sampled: number
  /** 取到了，但值是空。 */
  empty: number
  /** 还在等首帧。 */
  pending: number
  /** 取不到。 */
  error: number
}

/** 一次求值的全部产物。 */
export interface ModuleValues {
  /** 注入组件的 `values`，键是 `BindingSpec.key`，数组槽展开成行数组。 */
  values: Record<string, unknown>
  /** 逐槽的失败原因，键是 `fieldKey`。 */
  errors: Record<string, string>
  /**
   * 逐槽的取数结论，键是 `fieldKey`。
   * ⚠ 只有**配过来源**的槽在这里有键：没配的槽压根不是一条绑定，
   * 「这一格没接数据源」与「接了但取不到」因此靠键在不在分得开。
   */
  slots: Record<string, ModuleSlotMeta>
  tally: ModuleValuesTally
  /** 这批值里最新的采样时刻，UTC 毫秒；一个都没有则 null。 */
  valueTimeMs: number | null
}

export interface ModuleValuesInput {
  /** 模块清单声明的绑定槽（注入，不查注册表）。 */
  specs: readonly BindingSpec[]
  /** 该节点的全部绑定。 */
  bindings: readonly BindingView[]
  read: BindingValueReader
}

/** 派生绑定的输入互相引用、收敛不了时的原因。 */
const CYCLE_MESSAGE = '派生绑定的输入成环，收敛不了'

/** 数组槽的 `fieldKey`：`rows[0]` 或 `rows[0].value`。 */
const ARRAY_FIELD_KEY =
  /^(?<key>[A-Za-z_$][\w$-]*)\[(?<index>\d+)\](?:\.(?<sub>[A-Za-z_$][\w$-]*))?$/

interface EvaluationState {
  values: Record<string, unknown>
  errors: Record<string, string>
  slots: Record<string, ModuleSlotMeta>
  siblings: Record<string, unknown>
  tally: ModuleValuesTally
  valueTimeMs: number | null
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 按 `fieldKey` 把值放进 values：普通键直写，数组槽展开回 `rows[0].value`。
 * @param values 注入袋
 * @param fieldKey 绑定的槽键
 * @param value 求值结果
 */
export function injectFieldValue(
  values: Record<string, unknown>,
  fieldKey: string,
  value: unknown,
): void {
  const groups = ARRAY_FIELD_KEY.exec(fieldKey)?.groups
  const key = groups?.key
  const index = groups?.index
  if (key === undefined || index === undefined) {
    values[fieldKey] = value
    return
  }
  const rows = ensureArray(values, key)
  const at = Number(index)
  const sub = groups?.sub
  if (sub === undefined) rows[at] = value
  else ensureRow(rows, at)[sub] = value
}

function ensureArray(bag: Record<string, unknown>, key: string): unknown[] {
  const current = bag[key]
  if (isUnknownArray(current)) return current
  const created: unknown[] = []
  bag[key] = created
  return created
}

function ensureRow(rows: unknown[], index: number): Record<string, unknown> {
  const current = rows[index]
  if (isRecord(current)) return current
  const created: Record<string, unknown> = {}
  rows[index] = created
  return created
}

/**
 * 时序槽的伴生序列键：`rows[0].series` → 同一行的 `rows[0].seriesPoints`。
 * 不是数组行子槽的槽键给 `undefined`。
 *
 * ⚠ 序列只能落在行内，顶层槽一律不注入：`manifests.contract.spec.ts` 那条
 * 「绑定槽键两侧逐一对上」按模块目录扫 `values.<键>` 并要求与清单声明的槽键
 * 逐一相等，顶层槽 `foo` 的伴生键 `fooPoints` 会被判成暗键、当场红；行对象
 * 里的键不参与那次扫描。
 * @param fieldKey 绑定的槽键
 */
export function pointsFieldKeyOf(fieldKey: string): string | undefined {
  const groups = ARRAY_FIELD_KEY.exec(fieldKey)?.groups
  return groups?.sub === undefined ? undefined : `${fieldKey}Points`
}

/**
 * 找 `fieldKey` 对应的绑定槽声明，数组槽落到行内子槽上。
 * @param specs 模块清单声明的绑定槽
 * @param fieldKey 绑定的槽键
 */
export function resolveBindingSpec(
  specs: readonly BindingSpec[],
  fieldKey: string,
): BindingSpec | undefined {
  const groups = ARRAY_FIELD_KEY.exec(fieldKey)?.groups
  const parent = specs.find((spec) => spec.key === (groups?.key ?? fieldKey))
  const sub = groups?.sub
  if (parent === undefined || sub === undefined) return parent
  return parent.arrayFields?.find((spec) => spec.key === sub)
}

/**
 * 定值变换：先乘后加再取整。
 * ⚠ 只作用于真正的 `number`：精确小数从后端是字符串，`Number(v)` 之后再算是有损的。
 * @param value 取到的原值
 * @param transform 绑定上的变换；没有则原样返回
 */
function applyTransform(
  value: unknown,
  transform: BindingTransform | null,
): unknown {
  if (transform === null || typeof value !== 'number') return value
  const scaled = value * (transform.scale ?? 1) + (transform.offset ?? 0)
  const round = transform.round
  if (round === null || round === undefined || !Number.isFinite(round)) {
    return scaled
  }
  const unit = Math.pow(10, round)
  const rounded = Math.round(scaled * unit) / unit
  return Number.isFinite(rounded) ? rounded : scaled
}

/**
 * 逐点跑同一份定值变换。
 * ⚠ 序列必须跟着标量一起换算：配了 `scale: 0.001` 的系列只换末值不换曲线，
 * 得到的是「Y 轴与曲线是帕、末值与提示框是千帕」，差三个数量级且零报错。
 * `applyEnumMap` 反过来对数值序列没有意义，不跑。
 * @param points 取回的原始序列
 * @param transform 绑定上的变换；没有则原样返回同一个数组
 */
function transformPoints(
  points: readonly HistoryPoint[],
  transform: BindingTransform | null,
): readonly HistoryPoint[] {
  if (transform === null) return points
  return points.map((point) => ({
    t: point.t,
    v: applyTransform(point.v, transform),
  }))
}

/** enum 槽的数值 → 清单声明的语义值；映射里没有的数值原样保留。 */
function applyEnumMap(value: unknown, spec: BindingSpec | undefined): unknown {
  const enumMap = spec?.enumMap
  if (enumMap === undefined || typeof value !== 'number') return value
  // ⚠ 显式转字符串：映射的键来自 JSON，永远是字符串
  return enumMap[String(value)] ?? value
}

/**
 * 求一个模块实例的全部绑定。
 * @param input 绑定槽声明、绑定列表与注入的读取器
 */
export function computeModuleValues(input: ModuleValuesInput): ModuleValues {
  const state: EvaluationState = {
    values: {},
    errors: {},
    slots: {},
    siblings: {},
    tally: { bound: 0, ok: 0, empty: 0, pending: 0, error: 0, sampled: 0 },
    valueTimeMs: null,
  }
  const derived: BindingView[] = []
  for (const binding of input.bindings) {
    if (binding.computeJson === null) resolveBinding(binding, input, state)
    else derived.push(binding)
  }
  resolveDerived(derived, input, state)
  return {
    values: state.values,
    errors: state.errors,
    slots: state.slots,
    tally: state.tally,
    valueTimeMs: state.valueTimeMs,
  }
}

/** 读一条绑定并把结果记进各档计数。 */
function resolveBinding(
  binding: BindingView,
  input: ModuleValuesInput,
  state: EvaluationState,
): void {
  state.tally.bound += 1
  const slot = input.read(binding, state.siblings)
  if (slot.state === 'pending') {
    state.tally.pending += 1
    state.slots[binding.fieldKey] = { state: 'pending' }
    return
  }
  if (slot.state === 'error') {
    state.tally.error += 1
    state.errors[binding.fieldKey] = slot.message
    state.slots[binding.fieldKey] = { state: 'error', message: slot.message }
    return
  }
  noteTimestamp(state, slot.timestampMs)
  state.slots[binding.fieldKey] = okSlotMeta(slot)
  injectPoints(state.values, binding, slot.points)
  const spec = resolveBindingSpec(input.specs, binding.fieldKey)
  const value = applyEnumMap(
    applyTransform(slot.value, binding.transformJson),
    spec,
  )
  if (value === null || value === undefined) state.tally.empty += 1
  else {
    state.tally.ok += 1
    if (slot.timestampMs !== undefined) state.tally.sampled += 1
  }
  state.siblings[binding.fieldKey] = value
  injectFieldValue(state.values, binding.fieldKey, value)
}

/**
 * `ok` 档的逐槽结论。可选的三样一律「有才写」——缺席与显式 `undefined`
 * 在读侧不是一回事。
 * ⚠ 逐槽各带各的时刻：整块只留最新的那一个，而多点位模块里「哪一格不动了」
 * 正是要靠各自的时刻才看得出来。
 * @param slot 读取器给出的 `ok` 结果
 */
function okSlotMeta(
  slot: Extract<BindingSlot, { state: 'ok' }>,
): ModuleSlotMeta {
  return {
    state: 'ok',
    ...(slot.timestampMs !== undefined
      ? { timestampMs: slot.timestampMs }
      : {}),
    ...(slot.isTruncated !== undefined
      ? { isTruncated: slot.isTruncated }
      : {}),
    ...(slot.isStale !== undefined ? { isStale: slot.isStale } : {}),
  }
}

/**
 * 把序列注入到同一行的伴生键上，逐点跑绑定自己的定值变换。
 * @param values 注入袋
 * @param binding 这条绑定，变换与槽键都从它来
 * @param points 读取器给出的序列；缺席就一个点都不写
 */
function injectPoints(
  values: Record<string, unknown>,
  binding: BindingView,
  points: readonly HistoryPoint[] | undefined,
): void {
  if (points === undefined) return
  const key = pointsFieldKeyOf(binding.fieldKey)
  if (key === undefined) return
  injectFieldValue(values, key, transformPoints(points, binding.transformJson))
}

function noteTimestamp(
  state: EvaluationState,
  timestampMs: number | undefined,
): void {
  if (timestampMs === undefined) return
  state.valueTimeMs =
    state.valueTimeMs === null
      ? timestampMs
      : Math.max(state.valueTimeMs, timestampMs)
}

/**
 * 迭代求解派生槽：每一轮解掉输入已就绪的那些，直到没有进展。
 * 派生槽可以引用派生槽，所以不能一遍过；剩下的就是成环。
 */
function resolveDerived(
  derived: readonly BindingView[],
  input: ModuleValuesInput,
  state: EvaluationState,
): void {
  const unresolved = new Set(derived.map((binding) => binding.fieldKey))
  let pending: readonly BindingView[] = derived
  while (pending.length > 0) {
    const waiting: BindingView[] = []
    const ready: BindingView[] = []
    for (const binding of pending) {
      if (waitsForSibling(binding, unresolved)) waiting.push(binding)
      else ready.push(binding)
    }
    if (ready.length === 0) break
    for (const binding of ready) {
      unresolved.delete(binding.fieldKey)
      resolveBinding(binding, input, state)
    }
    pending = waiting
  }
  for (const binding of pending) reportCycle(binding, state)
}

function waitsForSibling(
  binding: BindingView,
  unresolved: ReadonlySet<string>,
): boolean {
  return (binding.computeJson?.inputs ?? []).some(
    (key) => key !== binding.fieldKey && unresolved.has(key),
  )
}

/** 成环的槽诚实给 null，并把原因写进 errors——空着看上去和「本来就没值」一样。 */
function reportCycle(binding: BindingView, state: EvaluationState): void {
  state.tally.bound += 1
  state.tally.error += 1
  state.errors[binding.fieldKey] = CYCLE_MESSAGE
  state.slots[binding.fieldKey] = { state: 'error', message: CYCLE_MESSAGE }
  state.siblings[binding.fieldKey] = null
  injectFieldValue(state.values, binding.fieldKey, null)
}
