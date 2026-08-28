/**
 * @fileoverview 画布上的实时值：订阅本屏绑定用到的点位，把快照喂给运行时的读取器。
 *
 * ⚠ `provideRuntimeData` 注入的是**函数不是值**：读取器在 computed 里被调用，
 * 响应式依赖由那次调用建立；传一个取好的值进来，值再变也不会重算且不报错。
 */

import type { DashboardNodeView, ModuleConnectionState } from '@dt/contracts'
import { provideRuntimeData } from '@dt/runtime'
import type { Ref } from 'vue'

import { usePointSamples } from '@/composables/usePointSamples'
import { boundPointKeys } from '@/features/dashboard/editorDoc'
import {
  createBindingReader,
  type ReadPointSample,
} from '@/runtime/bindingReader'

export interface DashboardValues {
  /** 收到过读数的点位数，供状态条显示。 */
  sampleCount: Ref<number>
  /**
   * 取一个点位当前的快照；没收到过给 undefined。
   * ⚠ 与画布渲染读的是**同一份**缓存：助手另发一次请求的话，会出现
   * 「助手说有值、画面上是占位符」。
   * ⚠ 每次调用都现取：取好再传下去的话，值再变也不会重算。
   */
  read: ReadPointSample
}

/**
 * 装上取数源并跟着绑定变化重订。须在 setup 内调用。
 * 收渲染子集：编辑器给的是全量草稿节点，公开页给的是窄面，都能装。
 * @param nodes 当前大屏的全部节点
 * @param scope 当前是哪张屏；跨屏跳转时订阅与快照都要跟着翻篇（见 usePointSamples）
 * @param connectionState 实时通道连接态，运行态的两张页面才给
 */
export function useDashboardValues(
  nodes: () => readonly DashboardNodeView[],
  scope: () => string,
  connectionState?: () => ModuleConnectionState,
): DashboardValues {
  const samples = usePointSamples(() => boundPointKeys(nodes()), scope)

  // ⚠ 不给连接态就是「这里没有实时通道」，模块永不标「数据可能过期」：
  // 编辑器画布是设计态，画一枚说通道断了的角标只会让人去查一条不存在的故障
  provideRuntimeData({
    readBinding: () => createBindingReader(samples.read),
    ...(connectionState === undefined ? {} : { connectionState }),
  })

  return { sampleCount: samples.sampleCount, read: samples.read }
}
