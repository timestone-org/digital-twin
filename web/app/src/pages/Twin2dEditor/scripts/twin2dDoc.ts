/**
 * @fileoverview 2D 孪生编辑器的文档态：一份配置、一份绑定，加一条撤销栈。
 *
 * ⚠ 写配置只有 `commit` 一个入口，而它**无条件**重派绑定。放开让各处自己写的话，
 * 总会有一个动作忘了重派——忘了之后界面上一切正常、读数照常刷新，只是那之后
 * 每一条绑定都接错了对象（`remapTwin2dBindings`，见
 * docs/MODULE_TWIN_2D_DESIGN.md §14.3）。
 * ⚠ 一帧装的是配置**与**绑定两样：只把配置进退，撤销一次就会让行号回到旧配置、
 * 绑定却停在新行号上。
 */
import type { BindingPayload } from '@dt/contracts'
import { remapTwin2dBindings } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

/** 撤销栈上限。⚠ 每一帧存的是整份配置，不封顶时长会话能吃掉几十兆。 */
export const TWIN_2D_HISTORY_LIMIT = 100

/** 一帧文档：配置与绑定一起进退，撤销才不会把两者错开。 */
interface Twin2dFrame {
  config: Twin2dConfig
  bindings: readonly BindingPayload[]
}

export interface Twin2dDoc {
  config: ComputedRef<Twin2dConfig>
  bindings: ComputedRef<readonly BindingPayload[]>
  /** 与上次「已保存」那一帧不同。 */
  isDirty: ComputedRef<boolean>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 写配置的唯一入口；顺带把绑定搬到新的行号上。 */
  commit: (next: Twin2dConfig) => void
  /**
   * 与上一帧合并的写入：`key` 相同就替换那一帧，不新增历史。
   *
   * ⚠ 给连续动作用（拖节点、拖手柄、逐键改标题）：逐帧各记一条的话，撤销一次
   * 只退回一帧，用户要按几十下才回得到原位。一段连续动作结束时调 `endMerge`，
   * 下一段才会重新开一帧。
   * @param next 新配置
   * @param key 这一段连续动作的标识
   */
  commitMerged: (next: Twin2dConfig, key: string) => void
  /** 一段连续动作结束了；下一次 `commitMerged` 重新开一帧。 */
  endMerge: () => void
  /**
   * 只改绑定不动配置（绑点面板写回）。
   *
   * `mergeKey` 与 `commitMerged` 同一套合并语义：同 key 的连续写入替换当前帧
   * （同一个槽的逐键输入并成一笔撤销），换 key / 不带 key 即断段另起一帧。
   * @param next 整份新绑定
   * @param mergeKey 这一段连续写入的标识（如 `binding:节点:槽键`）；一次性写入不传
   */
  commitBindings: (next: readonly BindingPayload[], mergeKey?: string) => void
  undo: () => void
  redo: () => void
  /** 保存成功后调；当前这一帧成为新的「干净」基准。 */
  markSaved: () => void
}

/** 撤销栈的三件套；收成一个对象是为了让下面几支不必逐个传。 */
interface History {
  frames: Ref<Twin2dFrame[]>
  index: Ref<number>
  savedIndex: Ref<number>
  /** 当前正在合并的那段连续动作；null = 没有。 */
  mergeKey: string | null
}

/**
 * 压一帧进历史。
 * ⚠ 撤销之后再改，被撤掉的那些帧就此丢弃——这是所有编辑器的既定行为。
 * ⚠ 溢出时从头砍；砍掉的帧里如果含着「已保存」那一帧，脏标记要跟着失效。
 * @param history 撤销栈
 * @param frame 要压进去的一帧
 */
function pushFrame(history: History, frame: Twin2dFrame): void {
  const { frames, index, savedIndex } = history
  const kept = frames.value.slice(0, index.value + 1)
  kept.push(frame)
  const overflow = Math.max(0, kept.length - TWIN_2D_HISTORY_LIMIT)
  frames.value = overflow > 0 ? kept.slice(overflow) : kept
  index.value = frames.value.length - 1
  savedIndex.value -= overflow
}

/**
 * 同一段连续动作：换掉当前这一帧，历史长度不变。
 * @param history 撤销栈
 * @param frame 顶替当前帧的那一帧
 */
function replaceFrame(history: History, frame: Twin2dFrame): void {
  const kept = history.frames.value.slice(0, history.index.value)
  kept.push(frame)
  history.frames.value = kept
  history.index.value = kept.length - 1
}

/**
 * 换一份配置，并把绑定搬到新的行号上。
 * @param previous 当前这一帧
 * @param next 新配置
 */
function frameOf(previous: Twin2dFrame, next: Twin2dConfig): Twin2dFrame {
  return {
    config: next,
    bindings: remapTwin2dBindings(previous.config, next, previous.bindings),
  }
}

/**
 * 配置没换引用就不记一帧；换了则连绑定一起搬到新行号上。
 * @param previous 当前这一帧
 * @param next 新配置
 */
function nextFrame(
  previous: Twin2dFrame,
  next: Twin2dConfig,
): Twin2dFrame | null {
  return next === previous.config ? null : frameOf(previous, next)
}

/**
 * 绑定帧落栈：同 key 替换当前帧（同一个槽的逐键输入并成一笔），
 * 换 key / 不带 key 即断段另起一帧——不带 key 也要断，否则随后同 key 的
 * `commitMerged` 会把这笔绑定写入连同它自己的帧一起并掉。
 * @param history 撤销栈
 * @param frame 只换了绑定的那一帧
 * @param key 这一段连续写入的标识；一次性写入是 undefined
 */
function pushBindingsFrame(
  history: History,
  frame: Twin2dFrame,
  key: string | undefined,
): void {
  if (key !== undefined && history.mergeKey === key) {
    replaceFrame(history, frame)
    return
  }
  history.mergeKey = key ?? null
  pushFrame(history, frame)
}

/**
 * 造一份文档态。
 * @param initial 从节点上读出来的配置与绑定
 */
export function createTwin2dDoc(initial: Twin2dFrame): Twin2dDoc {
  // ⚠ shallowRef：配置是整份换引用的，深响应式在每次 commit 上白走一遍全树
  const frames = shallowRef<Twin2dFrame[]>([initial])
  const index = ref(0)
  const savedIndex = ref(0)
  const history: History = { frames, index, savedIndex, mergeKey: null }

  const current = computed<Twin2dFrame>(() => {
    const frame = frames.value[index.value]
    // 越界只可能是本文件自己算错了下标；回退到第一帧而不是抛，避免整页白屏
    return frame ?? initial
  })

  return {
    config: computed(() => current.value.config),
    bindings: computed(() => current.value.bindings),
    // savedIndex 为负 = 那一帧已被撤销栈挤掉，此后一律算脏
    isDirty: computed(() => index.value !== savedIndex.value),
    canUndo: computed(() => index.value > 0),
    canRedo: computed(() => index.value < frames.value.length - 1),

    commit: (next) => {
      const frame = nextFrame(current.value, next)
      if (frame === null) return
      // 普通写入打断合并段：中间插了别的操作，再拖就该另起一帧
      history.mergeKey = null
      pushFrame(history, frame)
    },

    commitMerged: (next, key) => {
      const frame = nextFrame(current.value, next)
      if (frame === null) return
      if (history.mergeKey === key) return replaceFrame(history, frame)
      history.mergeKey = key
      pushFrame(history, frame)
    },

    endMerge: () => {
      history.mergeKey = null
    },

    commitBindings: (next, key) => {
      pushBindingsFrame(
        history,
        { config: current.value.config, bindings: [...next] },
        key,
      )
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
