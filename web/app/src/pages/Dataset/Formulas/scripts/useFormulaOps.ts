/**
 * @fileoverview 公式库页的写动作：开建 / 改弹窗，启停、恢复出厂口径与删除。
 *
 * ⚠ **停用与删除是同一种破坏力**：引用它的台账列在解析期就失败，而保存任一列
 * 都会试编译整张表，于是那张表的录入、导入、修正与重算一起报错。后端两处都
 * 409、都**没有 force 出口**，故这里也绝不摆一个强制入口——绕过去的代价是
 * 引用方在运行期才崩，而配那张表的人看不见（docs/DATASET_DESIGN.md §5.11）。
 * ⚠ 被 409 拦下的那句话必须**留在页面上**：它点名了受影响的台账，六秒之后
 * 消失的吐司装不下这种信息量。
 */

import { ref, type Ref } from 'vue'
import type { DatasetFormulaDef } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'

import * as formulas from '@/api/datasetFormulas'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

interface Deps {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  blocked: Ref<string | null>
  reload: () => Promise<void>
}

export interface FormulaOps {
  /** 正在改的那一条；`null` 即新建。 */
  editing: Ref<DatasetFormulaDef | null>
  isFormOpen: Ref<boolean>
  /** 被后端拦下的那一次操作的原因，点名了受影响的台账。 */
  blocked: Ref<string | null>
  openCreate: () => void
  openEdit: (formula: DatasetFormulaDef) => void
  toggleEnabled: (formula: DatasetFormulaDef) => Promise<void>
  restorePreset: (formula: DatasetFormulaDef) => Promise<void>
  removeFormula: (formula: DatasetFormulaDef) => Promise<void>
  /** 弹窗保存成功后：报一句、重新取数。 */
  afterSaved: (message: string) => Promise<void>
  dismissBlocked: () => void
}

/**
 * 后端是不是因为「还有人在用它」拒绝的。
 * ⚠ 按码分支，不按 message：文案会改。而**要展示的正是** message——
 * 受影响的是哪几张表只在那句话里，前端不许自己再查一遍。
 * @param caught 抛出来的东西
 */
function inUseReason(caught: unknown): string | null {
  const isBlocked =
    caught instanceof BizError &&
    caught.code === ERROR_CODES.datasetFormulaInUse
  return isBlocked ? caught.message : null
}

/**
 * 失败的两条路：被引用拦下（留在页面上），与其余（一句吐司）。
 * @param deps 吐司、确认框、拦截原因与重取
 * @param caught 抛出来的东西
 */
function reportFailure(deps: Deps, caught: unknown): void {
  const blocked = inUseReason(caught)
  if (blocked === null) {
    deps.toast.error(describeError(caught))
    return
  }
  // 两个都要：吐司在点击处附近立刻回应，横幅留着让人读完那串台账名
  deps.blocked.value = blocked
  deps.toast.error('操作被拦下，原因见页面顶部')
}

async function toggleEnabled(
  deps: Deps,
  formula: DatasetFormulaDef,
): Promise<void> {
  if (formula.is_enabled && !(await askDisable(deps, formula))) return
  deps.blocked.value = null
  try {
    await formulas.updateDatasetFormula(formula.id, {
      is_enabled: !formula.is_enabled,
    })
  } catch (caught) {
    reportFailure(deps, caught)
    return
  }
  deps.toast.success(formula.is_enabled ? '已停用' : '已启用')
  await deps.reload()
}

/** 停用前把后果说全。启用不问：它只会让更多东西算得出来。 */
function askDisable(deps: Deps, formula: DatasetFormulaDef): Promise<boolean> {
  return deps.confirm.ask({
    title: '停用库公式',
    message:
      `停用「${formula.name}」不是把它藏起来：引用它的台账列会在解析期失败，` +
      '那几张表的数据录入、批量导入、人工修正与重算会一起报错。' +
      '还有人在用它的话，这一步会被拦下。',
    confirmText: '停用',
    danger: true,
  })
}

async function restorePreset(
  deps: Deps,
  formula: DatasetFormulaDef,
): Promise<void> {
  const confirmed = await deps.confirm.ask({
    title: '恢复出厂口径',
    message:
      `将把「${formula.name}」的名称、分类、公式体与形参还原成出厂设置，` +
      '引用它的台账列要重算之后才按出厂口径出数。' +
      '⚠ 启用开关不动——恢复的是口径，不是开关。',
    confirmText: '恢复',
  })
  if (!confirmed) return
  deps.blocked.value = null
  try {
    await formulas.restoreDatasetFormula(formula.id)
  } catch (caught) {
    reportFailure(deps, caught)
    return
  }
  deps.toast.success('已恢复出厂口径，引用它的台账列需重算')
  await deps.reload()
}

async function removeFormula(
  deps: Deps,
  formula: DatasetFormulaDef,
): Promise<void> {
  const confirmed = await deps.confirm.ask({
    title: '删除库公式',
    message:
      `将删除「${formula.name}」，这一步不可撤销。` +
      '还有台账列、或库里别的公式在调它的话，这次删除会被拦下' +
      '——没有强制删除的出口。',
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  deps.blocked.value = null
  try {
    await formulas.deleteDatasetFormula(formula.id)
  } catch (caught) {
    reportFailure(deps, caught)
    return
  }
  deps.toast.success('库公式已删除')
  await deps.reload()
}

/**
 * 装上这一页的写动作。
 * @param reload 写完之后重新取数
 */
export function useFormulaOps(reload: () => Promise<void>): FormulaOps {
  const blocked = ref<string | null>(null)
  const deps: Deps = {
    toast: useToast(),
    confirm: useConfirm(),
    blocked,
    reload,
  }
  const editing = ref<DatasetFormulaDef | null>(null)
  const isFormOpen = ref(false)

  return {
    editing,
    isFormOpen,
    blocked,
    openCreate: () => {
      editing.value = null
      isFormOpen.value = true
    },
    openEdit: (formula) => {
      editing.value = formula
      isFormOpen.value = true
    },
    toggleEnabled: (formula) => toggleEnabled(deps, formula),
    restorePreset: (formula) => restorePreset(deps, formula),
    removeFormula: (formula) => removeFormula(deps, formula),
    afterSaved: async (message) => {
      blocked.value = null
      deps.toast.success(message)
      await reload()
    },
    dismissBlocked: () => (blocked.value = null),
  }
}
