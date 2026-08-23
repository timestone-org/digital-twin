/**
 * @fileoverview 把一条绑定读成 `@dt/runtime` 要的 `BindingSlot`：
 * 实时点位查快照缓存、常量与派生就地算、序列类（点位历史与台账）诚实拒绝。
 *
 * ⚠ 按 `sourceKind` 穷举分支，末尾有一条 `never` 兜底：`BindingSourceKind`
 * 是闭合联合，再加一种来源时这里**编译不过**，而不是安静地少认一种
 * （docs/DASHBOARD_DESIGN.md §5.5）。
 * ⚠ 取不到就说取不到：没有快照就是 `pending`，取数失败就是 `error`，
 * 绝不拿 `null` 冒充「现场报的就是空」。
 */
import type { BindingView, PointSample } from '@dt/contracts'
import { computeValue, resolveStaticValue } from '@dt/datasources'
import type { BindingSlot, BindingValueReader } from '@dt/runtime'

/** 序列类来源要异步取数，同步的读取器给不出——说清楚，不留白。 */
const SERIES_MESSAGE = '序列要异步取数，画布上不展开'

/** 实时点位还没配点位身份。 */
const NO_POINT_MESSAGE = '实时绑定还没挑点位'

/** 取一个点位当前的快照；没收到过给 undefined。 */
export type ReadPointSample = (nodeKey: string) => PointSample | undefined

/** 一个点位的快照 → 一条槽的结果。 */
function slotOfSample(sample: PointSample): BindingSlot {
  if (sample.state === 'error') {
    return { state: 'error', message: sample.errorMessage }
  }
  return {
    state: 'ok',
    value: sample.value,
    // ⚠ 照实带上采样时刻：模块要显示「更新于」全靠它，而值有多旧不由这里判
    timestampMs: sample.timestampMs,
  }
}

/**
 * 造一个绑定读取器。
 * @param readPoint 快照缓存的查询函数
 */
export function createBindingReader(
  readPoint: ReadPointSample,
): BindingValueReader {
  return (binding: BindingView, siblings): BindingSlot => {
    const kind = binding.sourceKind
    if (kind === 'opcua') {
      if (binding.nodeKey === null) {
        return { state: 'error', message: NO_POINT_MESSAGE }
      }
      const sample = readPoint(binding.nodeKey)
      return sample === undefined ? { state: 'pending' } : slotOfSample(sample)
    }
    if (kind === 'static') {
      const slot = resolveStaticValue(binding.staticValueJson)
      return slot.state === 'ok'
        ? { state: 'ok', value: slot.value }
        : { state: 'error', message: slot.error.message }
    }
    if (kind === 'computed') {
      const spec = binding.computeJson
      if (spec === null) {
        return { state: 'error', message: '派生绑定没有配置运算规格' }
      }
      return { state: 'ok', value: computeValue(spec, siblings) }
    }
    if (kind === 'archive' || kind === 'dataset') {
      return { state: 'error', message: SERIES_MESSAGE }
    }
    return assertNever(kind)
  }
}

/** 新增一种来源却没在上面认它时，这一行编译不过。 */
function assertNever(kind: never): never {
  throw new Error(`没有认出的绑定来源：${String(kind)}`)
}
