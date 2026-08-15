/**
 * @fileoverview 孪生编辑器的文档态：一份配置、一份绑定，加一条撤销栈。
 *
 * ⚠ 写配置只有 `commit` 一个入口，而它**无条件**重派绑定。放开让各处自己写的话，
 * 总会有一个动作忘了重派——忘了之后界面上一切正常、读数照常刷新，只是那之后
 * 每一条绑定都接错了对象（见 `remapTwinBindings`）。
 */
import type { BindingPayload } from '@dt/contracts'
import { type TwinConfig, remapTwinBindings } from '@dt/twin-config'
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'

/** 撤销栈上限。⚠ 每一帧存的是整份配置，不封顶时长会话能吃掉几十兆。 */
export const TWIN_HISTORY_LIMIT = 100

/** 一帧文档：配置与绑定一起进退，撤销才不会把两者错开。 */
interface TwinFrame {
  config: TwinConfig
  bindings: readonly BindingPayload[]
}

export interface TwinDoc {
  config: ComputedRef<TwinConfig>
  bindings: ComputedRef<readonly BindingPayload[]>
  /** 与上次「已保存」那一帧不同。 */
  isDirty: ComputedRef<boolean>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 写配置的唯一入口；顺带把绑定搬到新的行号上。 */
  commit: (next: TwinConfig) => void
  /** 只改绑定不动配置（绑点面板写回）。 */
  commitBindings: (next: readonly BindingPayload[]) => void
  undo: () => void
  redo: () => void
  /** 保存成功后调；当前这一帧成为新的「干净」基准。 */
  markSaved: () => void
}

/**
 * 造一份文档态。
 * @param initial 从节点上读出来的配置与绑定
 */
export function createTwinDoc(initial: TwinFrame): TwinDoc {
  // ⚠ shallowRef：配置是整份换引用的，深响应式在每次 commit 上白走一遍全树
  const frames = shallowRef<TwinFrame[]>([initial])
  const index = ref(0)
  const savedIndex = ref(0)

  const current = computed<TwinFrame>(() => {
    const frame = frames.value[index.value]
    // 越界只可能是本文件自己算错了下标；回退到第一帧而不是抛，避免整页白屏
    return frame ?? initial
  })

  function push(frame: TwinFrame): void {
    // 撤销之后再改，被撤掉的那些帧就此丢弃——这是所有编辑器的既定行为
    const kept = frames.value.slice(0, index.value + 1)
    kept.push(frame)
    // 溢出时从头砍；砍掉的帧里如果含着「已保存」那一帧，脏标记要跟着失效
    const overflow = Math.max(0, kept.length - TWIN_HISTORY_LIMIT)
    frames.value = overflow > 0 ? kept.slice(overflow) : kept
    index.value = frames.value.length - 1
    savedIndex.value -= overflow
  }

  return {
    config: computed(() => current.value.config),
    bindings: computed(() => current.value.bindings),
    // savedIndex 为负 = 那一帧已被撤销栈挤掉，此后一律算脏
    isDirty: computed(() => index.value !== savedIndex.value),
    canUndo: computed(() => index.value > 0),
    canRedo: computed(() => index.value < frames.value.length - 1),

    commit: (next) => {
      const previous = current.value
      if (next === previous.config) return
      push({
        config: next,
        bindings: remapTwinBindings(previous.config, next, previous.bindings),
      })
    },

    commitBindings: (next) => {
      push({ config: current.value.config, bindings: [...next] })
    },

    undo: () => {
      if (index.value > 0) index.value -= 1
    },

    redo: () => {
      if (index.value < frames.value.length - 1) index.value += 1
    },

    markSaved: () => {
      savedIndex.value = index.value
    },
  }
}
