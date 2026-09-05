/**
 * @fileoverview 时序槽取数的生命周期接线：绑定签名一变就发起一次批量取数、
 * 作废在飞的上一次、作用域销毁时全量作废。算法全在 `seriesSlots.ts`，
 * 这里只留 watch / abort / onScopeDispose 三样。
 */
import type {
  BindingSpec,
  BindingView,
  SeriesOutcome,
  SeriesReader,
} from '@dt/contracts'
import {
  computed,
  onScopeDispose,
  shallowRef,
  watch,
  type ShallowRef,
} from 'vue'

import type { BindingSlot } from './moduleValues'
import {
  openingSlots,
  planSeries,
  readErrorMessage,
  slotsOfFailure,
  slotsOfOutcomes,
  type SeriesPlan,
} from './seriesSlots'

export interface SeriesSlotsInput {
  /** 模块清单声明的绑定槽。 */
  specs: () => readonly BindingSpec[]
  /** 该节点的全部绑定。 */
  bindings: () => readonly BindingView[]
  /**
   * 批量取数口。
   * ⚠ 不装就是「这里没有历史取数」（设计态画布、模块库缩略图、公开屏），
   * 这一层于是一条槽都不接管，时序槽照常走注入的那份读取器。
   */
  read: () => SeriesReader | undefined
  /** 刷新节拍序号，每 +1 重取一轮。 */
  epoch: () => number
}

/** 一条时序槽都不接管。 */
const NO_SLOTS: ReadonlyMap<string, BindingSlot> = new Map()

/** 没有在飞的那一轮时的签名，任何回来的结果都对不上它。 */
const NO_RUN = ''

/** 一格模块的在飞状态。 */
interface RunState {
  slots: ShallowRef<ReadonlyMap<string, BindingSlot>>
  inFlight: AbortController | null
  /** 当前这一轮的签名。 */
  running: string
  /** 上一轮每条请求的取数身份。 */
  carried: ReadonlyMap<string, string>
}

/**
 * 收下一轮取数的结果。
 * ⚠ abort 只让请求早点返回，拦不住**已经拿到结果**的那一次：晚到的结果必须
 * 自己认输，否则换了绑定之后旧数据还会覆盖上来一次。
 * @param state 这一格的在飞状态
 * @param current 发起这一轮的计划
 * @param pending 取数适配器给的承诺
 */
async function settle(
  state: RunState,
  current: SeriesPlan,
  pending: Promise<ReadonlyMap<string, SeriesOutcome>>,
): Promise<void> {
  try {
    const outcomes = await pending
    if (state.running !== current.signature) return
    state.slots.value = slotsOfOutcomes(current, outcomes)
  } catch (error) {
    if (state.running !== current.signature) return
    state.slots.value = slotsOfFailure(current, readErrorMessage(error))
  }
}

/**
 * 换一轮取数：先作废上一次，再按新计划发一次。
 * @param state 这一格的在飞状态
 * @param current 这一轮的计划
 * @param read 批量取数口；缺席就一条槽都不接管
 */
function start(
  state: RunState,
  current: SeriesPlan,
  read: SeriesReader | undefined,
): void {
  state.inFlight?.abort()
  state.inFlight = null
  if (read === undefined) {
    state.running = NO_RUN
    state.slots.value = NO_SLOTS
    state.carried = new Map()
    return
  }
  state.running = current.signature
  state.slots.value = openingSlots(current, state.slots.value, state.carried)
  state.carried = current.detailKeys
  if (current.requests.length === 0) return
  const own = new AbortController()
  state.inFlight = own
  void settle(state, current, read(current.requests, own.signal))
}

/**
 * 装上一格的时序槽取数。
 * ⚠ watch 的依赖只有「绑定与清单派生出来的签名」，绝不含槽表本身：
 * 写槽 → values 重算 → 再驱动一次，那是一个不报错的无限循环。
 * @param input 清单、绑定、批量取数口与节拍，全部以 getter 注入
 */
export function useSeriesSlots(
  input: SeriesSlotsInput,
): ShallowRef<ReadonlyMap<string, BindingSlot>> {
  const state: RunState = {
    slots: shallowRef<ReadonlyMap<string, BindingSlot>>(NO_SLOTS),
    inFlight: null,
    running: NO_RUN,
    carried: new Map(),
  }
  const plan = computed(() =>
    planSeries({
      specs: input.specs(),
      bindings: input.bindings(),
      epoch: input.epoch(),
    }),
  )
  watch(
    () => plan.value.signature,
    () => start(state, plan.value, input.read()),
    { immediate: true },
  )
  onScopeDispose(() => {
    state.inFlight?.abort()
    state.inFlight = null
    state.running = NO_RUN
  })
  return state.slots
}
