/**
 * @fileoverview 运行态取数的注入接缝：本包一个 HTTP 请求都不发，也不认识任何
 * 具体来源——「读一条绑定」的能力由应用壳 `provide` 下来（docs/DASHBOARD_DESIGN.md §7）。
 * ⚠ 注入的是**函数不是值**：`ModuleRenderer` 在 computed 里调用它，响应式依赖由那次
 * 调用建立；传一个取好的值进来，值再变也不会重算，而且不报任何错。
 */
import type { ModuleConnectionState } from '@dt/contracts'
import { inject, provide, type InjectionKey } from 'vue'

import type { BindingSlot, BindingValueReader } from './moduleValues'

export interface RuntimeDataSource {
  /** 取当前的绑定读取器；每次求值都重新调用它。 */
  readBinding: () => BindingValueReader
  /**
   * 取实时通道此刻的连接态；每次求值都重新调用它。
   * ⚠ 不装这一支就是「这里没有实时通道」（设计态画布、独立渲染、用例），
   * 于是模块永远不会被标成陈旧——而不是被当成断开。
   */
  connectionState?: () => ModuleConnectionState
}

export const RUNTIME_DATA_KEY: InjectionKey<RuntimeDataSource> =
  Symbol('dt-runtime-data')

/** 没装配取数源时每条绑定的结果。取不到就说取不到，不静默留白。 */
const UNWIRED: BindingSlot = {
  state: 'error',
  message: '没有装配取数源',
}

/**
 * 诚实空源：任何绑定都读不到，且说得出为什么。
 * 未 `provide` 的子树（独立挂载的组件、只测布局的用例）据此照常渲染。
 */
export function emptyRuntimeData(): RuntimeDataSource {
  return { readBinding: () => () => UNWIRED }
}

const EMPTY = emptyRuntimeData()

/**
 * 给本子树装上取数源。须在 setup 内调用。
 * @param source 应用壳装配好的取数源
 */
export function provideRuntimeData(source: RuntimeDataSource): void {
  provide(RUNTIME_DATA_KEY, source)
}

/** 取本子树的取数源；没装过就是诚实空源。须在 setup 内调用。 */
export function useRuntimeData(): RuntimeDataSource {
  return inject(RUNTIME_DATA_KEY, EMPTY)
}
