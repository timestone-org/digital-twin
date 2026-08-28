/**
 * @fileoverview 一格模块的「取数 → 状态 → meta」这一段，从装配点里抽出来。
 * 入参全是 getter，所以它不认识 props、也不 inject 任何东西——装配点之外
 * （测试、别的宿主）能直接装上它。
 */
import type {
  BindingView,
  ModuleConnectionState,
  ModuleManifest,
  ModuleMeta,
} from '@dt/contracts'
import { computed, type ComputedRef } from 'vue'

import {
  computeModuleStatus,
  countUnboundRequired,
  showsStatusOverlay,
  type ModuleStatusInput,
} from './moduleStatus'
import {
  computeModuleValues,
  type BindingValueReader,
  type ModuleValues,
} from './moduleValues'

export interface ModuleEvaluationInput {
  manifest: () => ModuleManifest | undefined
  bindings: () => readonly BindingView[]
  nodeId: () => string | undefined
  /** 取数读取器。⚠ 每次求值都重新调它，响应式依赖靠这次调用建立。 */
  read: () => BindingValueReader
  /** 这一格是不是已经渲染失败了（失败时状态直接是 error）。 */
  hasRenderError: () => boolean
  /** 本节点真配了以它为源的联动规则；无联动运行时给 undefined。 */
  interactive: () => boolean | undefined
  /** 实时通道连接态；设计态与独立渲染时给 undefined，那时永不降 `stale`。 */
  connectionState: () => ModuleConnectionState | undefined
}

export interface ModuleEvaluation {
  evaluated: ComputedRef<ModuleValues>
  meta: ComputedRef<ModuleMeta>
  /** 要不要盖整格状态浮层，理由见 `showsStatusOverlay`。 */
  showStatusOverlay: ComputedRef<boolean>
}

/**
 * 折状态要的那几样：渲染失败、必绑缺口、各档槽计数与连接态。
 * @param input 装配点注入的 getter 们
 * @param values 这一轮的求值结果
 * @param connection 连接态；缺席就是这里没有实时通道
 */
function statusInputOf(
  input: ModuleEvaluationInput,
  values: ModuleValues,
  connection: ModuleConnectionState | undefined,
): ModuleStatusInput {
  return {
    hasRenderError: input.hasRenderError(),
    unboundRequiredCount: countUnboundRequired(
      input.manifest()?.bindings ?? [],
      input.bindings(),
    ),
    tally: values.tally,
    ...(connection === undefined ? {} : { connectionState: connection }),
  }
}

/** 状态条只放得下一句，取第一条槽的原因；逐槽原因在求值结果里。 */
function firstReason(errors: Readonly<Record<string, string>>): string {
  const [first] = Object.entries(errors)
  return first === undefined ? '' : `${first[0]}：${first[1]}`
}

/**
 * 装上一格的求值。
 * @param input 清单、绑定、节点身份与取数读取器，全部以 getter 注入
 */
export function useModuleEvaluation(
  input: ModuleEvaluationInput,
): ModuleEvaluation {
  const evaluated = computed(() =>
    computeModuleValues({
      specs: input.manifest()?.bindings ?? [],
      bindings: input.bindings(),
      read: input.read(),
    }),
  )

  // ⚠ 连接态在 computed 里取：取好再传进来的话，通道断了这一格也不会重算
  const connectionState = computed(() => input.connectionState())

  const status = computed(() =>
    computeModuleStatus(
      statusInputOf(input, evaluated.value, connectionState.value),
    ),
  )

  // 模块自报「逐格状态我自己交代」
  const ownsStatus = computed(
    () => input.manifest()?.ownsStatusDisplay === true,
  )

  const meta = computed<ModuleMeta>(() => {
    const value: ModuleMeta = { status: status.value }
    const nodeId = input.nodeId()
    if (nodeId !== undefined) value.nodeId = nodeId
    // ⚠ 逐槽结论只下发给自报的模块：其余模块读了也没有地方画
    if (ownsStatus.value) value.slots = evaluated.value.slots
    if (evaluated.value.valueTimeMs !== null) {
      value.valueTimeMs = evaluated.value.valueTimeMs
    }
    const reason = firstReason(evaluated.value.errors)
    if (reason !== '') value.errorMessage = reason
    const interactive = input.interactive()
    if (interactive !== undefined) value.interactive = interactive
    if (connectionState.value !== undefined) {
      value.connectionState = connectionState.value
    }
    return value
  })

  return {
    evaluated,
    meta,
    showStatusOverlay: computed(() =>
      showsStatusOverlay(ownsStatus.value, status.value),
    ),
  }
}
