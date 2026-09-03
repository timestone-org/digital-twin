/**
 * @fileoverview 模型库上的三个动作：发布下线、绑公式、换绑与启停。
 *
 * ⚠ 换绑的回执带「哪些台账列会跟着变」，界面必须**如实报出来**：一条公式往往
 * 被多张台账引用，换一个版本等于同时改掉那些列的口径（MODELING_DESIGN §7.7）。
 * ⚠ 重算**不在这里做**：那是 `dataset:backfill` 档位的权限，由用户到台账页
 * 显式发起。
 */
import type {
  ModelFormulaRegistration,
  ModelingBindingImpact,
  ModelingVersionSummary,
} from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

type Toast = ReturnType<typeof useToast>

/** 下线前的问话。 */
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

/** 把回执里的影响面说成一句人话。一条都没有时也要说清楚。 */
export function impactText(impact: ModelingBindingImpact): string {
  if (impact.usages.length === 0) {
    return '目前还没有台账列引用这条公式。'
  }
  const columns = impact.usages
    .map((item) => `${item.table_code}.${item.column_key}`)
    .join('、')
  return `以下台账列的口径已经跟着变了，需要重算的话到台账页发起回填：${columns}`
}

async function attempt<T>(
  task: () => Promise<T>,
  toast: Toast,
): Promise<T | null> {
  try {
    return await task()
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
}

export function useBindingOps(onDone: () => void) {
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
    /** 把一个版本绑到一条公式上。 */
    bind: async (fxCode: string, versionId: string) => {
      const impact = await run(() =>
        modeling.createModelingBinding({
          fx_code: fxCode,
          model_version_id: versionId,
        }),
      )
      if (impact !== null) toast.success(impactText(impact))
    },
    /** 换版本或启停。 */
    update: async (
      bindingId: string,
      patch: { model_version_id?: string; is_enabled?: boolean },
    ) => {
      const impact = await run(() =>
        modeling.updateModelingBinding(bindingId, patch),
      )
      if (impact !== null) toast.success(impactText(impact))
    },
    /**
     * 一键注册为公式：一步建条目 + 建绑定。
     *
     * ⚠ 要**同时**有 `modeling:publish` 与 `dataset:manage`；缺后者时按钮
     * 由 `PermGuard` 禁用并说明原因，不是点下去才报错。
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
            '到台账里给某一列写 @' +
            done.formula.code +
            '(…) 就能出数。',
        )
      }
      return done
    },
    /** 解绑。公式条目本身不动。 */
    unbind: async (bindingId: string) => {
      const done = await run(() => modeling.deleteModelingBinding(bindingId))
      if (done !== undefined) toast.success('已解绑')
    },
  }
}
