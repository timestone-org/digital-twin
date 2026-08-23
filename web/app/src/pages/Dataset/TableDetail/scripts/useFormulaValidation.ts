/**
 * @fileoverview 公式的实时校验：防抖 400ms + 竞态守卫，把后端的结论收成一个
 * 状态机。语法知识一点都不在这里——「对不对」由 `formula:validate` 说了算。
 *
 * ⚠ 校验端点用 **200 + `is_ok=false`** 报语法错，那不是请求失败：编辑器里
 * 「还没写完」是正常状态，当成异常处理会让人每敲一个字看见一次报错
 * （docs/DATASET_DESIGN.md §6.1）。
 * ⚠ 文本一变就先熄灯：结论对应的是**上一份**文本，留着绿灯是最骗人的状态。
 * ⚠ 校验请求本身打不通时状态是 `unavailable` 而不是 `invalid`——「不知道对不对」
 * 不能读成「不对」，否则后端一抖，谁也别想保存公式列。
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import type {
  DatasetFormulaDeps,
  DatasetFormulaValidation,
} from '@dt/contracts'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 每敲一个字都发一次请求既吵、错误提示又会乱闪。 */
export const VALIDATE_DEBOUNCE_MS = 400

/**
 * 校验状态。
 * - `idle`：公式是空的，没什么可校验
 * - `checking`：改动之后、结论回来之前
 * - `ok` / `invalid`：后端说的
 * - `unavailable`：校验这条链路本身打不通
 */
export type FormulaCheckStatus =
  'idle' | 'checking' | 'ok' | 'invalid' | 'unavailable'

/** 显示用的那几格，随每次结论整体换掉。 */
interface CheckState {
  status: Ref<FormulaCheckStatus>
  /** 后端说的公式错误。 */
  error: Ref<string>
  /** 校验请求本身失败的原因。 */
  failure: Ref<string>
  /** 记号树，一团后端给的自由 JSON。 */
  notation: Ref<unknown>
  /** 一行读法，记号树画不出来时的兜底。 */
  readback: Ref<string>
  deps: Ref<DatasetFormulaDeps | null>
}

export interface FormulaCheck extends CheckState {
  /**
   * 结论是不是还对应框里这份文本；不同即作废。
   * @param formula 现在框里是什么
   */
  isFresh: (formula: string) => boolean
  /** 文本变了：先熄灯，再排一次防抖校验。 */
  retest: (formula: string) => void
}

export interface FormulaCheckTarget {
  tableId: () => string
  /** 正在编辑的那一列的 key；给了才做环检测。 */
  columnKey: () => string
}

function emptyState(): CheckState {
  return {
    status: ref<FormulaCheckStatus>('idle'),
    error: ref(''),
    failure: ref(''),
    notation: ref<unknown>(null),
    readback: ref(''),
    deps: ref<DatasetFormulaDeps | null>(null),
  }
}

/**
 * 熄灯：结论、读法、记号树一起清掉，只留状态。
 * @param state 显示用的那几格
 * @param next 熄灯之后处在哪一档
 */
function darken(state: CheckState, next: FormulaCheckStatus): void {
  state.status.value = next
  state.error.value = ''
  state.failure.value = ''
  state.notation.value = null
  state.readback.value = ''
  state.deps.value = null
}

/**
 * 收下一份后端结论。
 * @param state 显示用的那几格
 * @param result 校验回执
 */
function accept(state: CheckState, result: DatasetFormulaValidation): void {
  state.status.value = result.is_ok ? 'ok' : 'invalid'
  state.error.value = result.is_ok ? '' : (result.error ?? '公式写不通')
  state.notation.value = result.is_ok ? result.notation : null
  state.readback.value = result.is_ok ? (result.notation_text ?? '') : ''
  state.deps.value = result.is_ok ? result.deps : null
}

/**
 * 校验这条链路打不通。⚠ 不是 `invalid`：那会把「不知道」说成「不对」。
 * @param state 显示用的那几格
 * @param caught 抛出来的东西
 */
function unreachable(state: CheckState, caught: unknown): void {
  darken(state, 'unavailable')
  state.failure.value = describeError(caught)
}

/**
 * 装上一份实时校验。
 * @param target 打哪张台账、编辑的是哪一列
 */
export function useFormulaValidation(target: FormulaCheckTarget): FormulaCheck {
  const state = emptyState()
  /** 结论对应的那份文本。 */
  const checked = ref<string | null>(null)
  const raced = useRacedFetch()
  let timer: ReturnType<typeof setTimeout> | null = null

  async function validate(formula: string): Promise<void> {
    const draft = { formula, column_key: target.columnKey() || undefined }
    await raced.run(
      (signal) =>
        dataset.validateDatasetFormula(target.tableId(), draft, signal),
      {
        ok: (result) => {
          accept(state, result)
          checked.value = formula
        },
        fail: (caught) => {
          unreachable(state, caught)
          checked.value = formula
        },
        settled: () => undefined,
      },
    )
  }

  function retest(formula: string): void {
    if (timer !== null) clearTimeout(timer)
    checked.value = null
    if (formula.trim() === '') {
      raced.cancel()
      darken(state, 'idle')
      return
    }
    darken(state, 'checking')
    timer = setTimeout(() => void validate(formula), VALIDATE_DEBOUNCE_MS)
  }

  // ⚠ 弹窗关掉时定时器与在飞的那一次都要作废：它们回来照样写状态，
  // 而那份状态属于一个已经没人看的表单
  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer)
    raced.cancel()
  })

  return { ...state, isFresh: (formula) => checked.value === formula, retest }
}
