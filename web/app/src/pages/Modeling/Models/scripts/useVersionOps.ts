/**
 * @fileoverview 版本上的两个动作：下线、一键注册为公式。
 *
 * 与绑定那一组分开：这两个动作的对象是**版本**，爆炸半径也不同——下线会让绑在
 * 它上面的公式当场报「模型不可用」，注册则是往公式库里写一条新东西
 * （docs/MODELING_PLATFORM_DESIGN.md D17）。
 */
import type {
  ModelFormulaRegistration,
  ModelingVersionSummary,
} from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

import * as modeling from '@/api/modeling'

import { attempt } from './useBindingOps'

/** 下线前的问话。⚠ 要说清绑在它上面的公式会怎样。 */
function retireAsk(
  name: string,
  version: number,
): {
  title: string
  message: string
  confirmText: string
  danger: boolean
} {
  return {
    title: `下线「${name}」v${version}？`,
    message:
      '绑在这个版本上的公式会立刻开始报「模型不可用」，引用那条公式的台账列取不到数。换一个版本再下线它更稳。',
    confirmText: '下线',
    danger: true,
  }
}

export function useVersionOps(onDone: () => void) {
  const isBusy = ref(false)
  const toast = useToast()
  const confirm = useConfirm()

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    isBusy.value = true
    const done = await attempt(task, toast)
    isBusy.value = false
    if (done !== null) onDone()
    return done
  }

  return {
    isBusy,
    /** 下线一个版本。 */
    retire: async (row: ModelingVersionSummary) => {
      if (!(await confirm.ask(retireAsk(row.name, row.version)))) return
      const done = await run(() => modeling.retireModelingVersion(row.id))
      if (done !== null) toast.success('已下线')
    },
    /**
     * 一键注册为公式：一步建条目 + 建绑定。
     *
     * ⚠ 要**同时**有 `modeling:publish` 与 `dataset:manage`；缺后者时按钮由
     * `PermGuard` 禁用并说明原因，不是点下去才报错。
     */
    register: async (
      versionId: string,
      fxCode: string,
    ): Promise<ModelFormulaRegistration | null> => {
      const done = await run(() =>
        modeling.registerModelingFormula(versionId, fxCode),
      )
      if (done !== null) {
        toast.success(
          `已建好公式「${done.formula.code}」并绑上。` +
            `到台账里给某一列写 @${done.formula.code}(…) 就能出数。`,
        )
      }
      return done
    },
  }
}
