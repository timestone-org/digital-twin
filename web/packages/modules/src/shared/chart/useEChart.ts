/**
 * @fileoverview 图表挂载的唯一样板：建实例 → 首帧 → 尺寸/换肤跟随 → 释放。
 * 族组件因此只剩 props、空态口径与一个 build 闭包。
 * 容器不要求常驻：挂 v-if 或被 :key 置换时，元素出现即（重）建、消失即释放。
 */
import type { InteractionEvent } from '@dt/contracts'
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

import { createChart, type ChartHandle, type ECOption } from './echarts'
import { useThemeRedraw } from './theme'

export interface UseEChartOptions {
  /** 读主题的级联根，同时是换肤侦测的起点。 */
  rootRef: Ref<HTMLElement | null>
  /** 实例挂载点。 */
  chartRef: Ref<HTMLElement | null>
  /** 出 option；`full` 透传给各族，多数族忽略它、始终整构建。 */
  build: (full: boolean) => ECOption
  /** 触发全量重建的响应式源，通常 `() => props.config`。 */
  watchConfig: () => unknown
  /** 触发部分刷新的响应式源，通常 `() => props.values`。 */
  watchValues: () => unknown
  // ⚠ 这四项显式收 undefined：它们都是从壳的 props 原样透传下来的，
  // `exactOptionalPropertyTypes` 下不写 `| undefined` 就没法直接转手
  /** 值变时替换哪些键；缺省只换 series。 */
  partialMerge?: string[] | undefined
  /** 值 watch 的 deep 开关；`watchValues` 返回签名串做短路时须给 false。 */
  valuesDeep?: boolean | undefined
  /** 图元点击上抛联动事件；不传 = 不注册，点击行为完全不变。 */
  onItemClick?: ((event: InteractionEvent) => void) | undefined
  /** 点击取值口径；缺省「类目名，退回系列名」。 */
  itemValueOf?: ((params: unknown) => string) | undefined
}

/** echarts 点击回调里我们要用的几样东西（zrender 事件裹着原生事件）。 */
interface ChartClickParams {
  name?: unknown
  seriesName?: unknown
  event?: { event?: Event }
}

/** 缺省取值：类目名优先，退回系列名；都没有则空串 = 不上抛。 */
function defaultItemValue(raw: unknown): string {
  const params = (raw ?? {}) as ChartClickParams
  if (typeof params.name === 'string' && params.name) return params.name
  return typeof params.seriesName === 'string' ? params.seriesName : ''
}

function clickHandler(opts: UseEChartOptions): (raw: unknown) => void {
  const valueOf = opts.itemValueOf ?? defaultItemValue
  return (raw: unknown) => {
    const value = valueOf(raw)
    if (!value) return
    // ⚠ 吞掉这次点击的原生冒泡：外层 host 可能开着「整块可点」，不吞就同一次
    // 点击上抛两次，toggle 类动作当场自我抵消。
    ;(raw as ChartClickParams | null)?.event?.event?.stopPropagation()
    opts.onItemClick?.({ event: 'click', value })
  }
}

/** 实例与观察者的持有者，不碰 Vue 生命周期。 */
function createBinder(opts: UseEChartOptions) {
  let chart: ChartHandle | null = null
  let observer: ResizeObserver | null = null
  let boundEl: HTMLElement | null = null
  // 建实例要 await 动态 import；期间容器换了或已卸载，回来的实例必须当场扔掉
  let generation = 0

  function refresh(full: boolean): void {
    if (!chart) return
    const update = full
      ? { notMerge: true }
      : { replaceMerge: opts.partialMerge ?? ['series'] }
    chart.setOption(opts.build(full), update)
  }

  function detach(): void {
    generation += 1
    observer?.disconnect()
    observer = null
    chart?.dispose()
    chart = null
    boundEl = null
  }

  async function attach(el: HTMLElement): Promise<void> {
    detach()
    const token = generation
    boundEl = el
    const instance = await createChart(el)
    if (token !== generation) {
      instance.dispose()
      return
    }
    chart = instance
    // 事件必须每次重建都重新注册：实例是 dispose 后新建的，监听不会跟着活过来
    if (opts.onItemClick) instance.onClick(clickHandler(opts))
    refresh(true)
    observer = new ResizeObserver(() => instance.resize())
    observer.observe(el)
  }

  return {
    bind: (el: HTMLElement): void => {
      if (el !== boundEl) void attach(el)
    },
    detach,
    refresh,
    get: (): ChartHandle | null => chart,
  }
}

/**
 * 挂载图表并接线全部生命周期。
 * @param opts 容器、构建器与刷新源
 */
export function useEChart(opts: UseEChartOptions): {
  getChart: () => ChartHandle | null
} {
  const binder = createBinder(opts)

  onMounted(() => {
    if (opts.chartRef.value) binder.bind(opts.chartRef.value)
  })
  // 挂载时容器缺席（「无数据不渲染图区」）若不补这道 watch，实例永不初始化，
  // 之后 config/values 再怎么变都是静默 no-op。
  watch(opts.chartRef, (el) => {
    if (el) binder.bind(el)
    else binder.detach()
  })
  watch(opts.watchConfig, () => binder.refresh(true), { deep: true })
  watch(opts.watchValues, () => binder.refresh(false), {
    deep: opts.valuesDeep ?? true,
  })
  // 换肤必须整图重算：只换 series 改不掉轴、图例与提示框的颜色。
  useThemeRedraw(opts.rootRef, () => binder.refresh(true))
  onBeforeUnmount(binder.detach)

  return { getChart: binder.get }
}
