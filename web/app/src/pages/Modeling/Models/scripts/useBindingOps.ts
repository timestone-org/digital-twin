/**
 * @fileoverview 绑定上的三个动作：绑公式、换绑与启停、解绑。
 *
 * ⚠ 换绑的回执带「哪些台账列会跟着变」，界面必须**如实报出来**：一条公式往往
 * 被多张台账引用，换一个版本等于同时改掉那些列的口径（MODELING_DESIGN §7.7）。
 * ⚠ 重算**不在这里做**：那是 `dataset:backfill` 档位的权限，由用户到台账页
 * 显式发起。
 */
import type { ModelingBindingImpact } from '@dt/contracts'
import { useToast } from '@dt/ui'
import { ref } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

export type Toast = ReturnType<typeof useToast>

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

/** 跑一次动作，失败时把原因 toast 出来。给本目录另外那个组合式共用。 */
export async function attempt<T>(
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

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    isBusy.value = true
    const done = await attempt(task, toast)
    isBusy.value = false
    if (done !== null) onDone()
    return done
  }

  return {
    isBusy,
    /** 把一个版本绑到一条已有的公式条目上。 */
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
    /** 解绑。公式条目本身不动。 */
    unbind: async (bindingId: string) => {
      const done = await run(() => modeling.deleteModelingBinding(bindingId))
      if (done !== undefined) toast.success('已解绑')
    },
  }
}
