/**
 * @fileoverview 「引用守卫」两级删除的状态机：普通删除 409 时升级为强制删除。
 *
 * 数据源与点位共用：一级 confirm(false)；后端因被引用拒绝（409）时把冲突文案
 * 连同强删后果写进 `conflict`，弹窗随之进入二级；confirm(true) 显式跳过守卫。
 * ⚠ 其它错误照常 toast，不进入二级——把网络错误当成引用冲突，会诱导用户强删。
 */
import { ref, type Ref } from 'vue'
import { useToast } from '@dt/ui'

import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

// ⚠ 目标不约束成 `{ id, name }`：本文件一个字段都不读它，只是原样转交给
// `remove` / `conflictText`。约束住就等于「批量删除的目标必须假装成一条记录」
export interface ForceDelete<TargetT> {
  open: Ref<boolean>
  target: Ref<TargetT | null>
  busy: Ref<boolean>
  conflict: Ref<string | null>
  /** 打开一级确认。 */
  ask: (next: TargetT) => void
  /** 弹窗的 confirm 回调：force 为二级强删。 */
  confirm: (force: boolean) => Promise<void>
}

/**
 * 造一个两级删除流程。
 * @param remove 真正的删除调用
 * @param conflictText 409 时的二级文案（要把强删后果说出来）
 * @param done 删除成功后的收尾（刷新列表等）
 * @param successText 成功提示；批量删要把删掉几个说出来
 */
export function useForceDelete<TargetT>(
  remove: (target: TargetT, force: boolean) => Promise<void>,
  conflictText: (target: TargetT, message: string) => string,
  done: () => Promise<void> | void,
  successText: (target: TargetT) => string = () => '已删除',
): ForceDelete<TargetT> {
  const toast = useToast()
  const open = ref(false)
  const target = ref<TargetT | null>(null) as Ref<TargetT | null>
  const busy = ref(false)
  const conflict = ref<string | null>(null)

  function ask(next: TargetT): void {
    target.value = next
    conflict.value = null
    open.value = true
  }

  async function confirm(force: boolean): Promise<void> {
    const current = target.value
    if (current === null) return
    busy.value = true
    try {
      await remove(current, force)
      open.value = false
      toast.success(successText(current))
      await done()
    } catch (caught) {
      if (!force && caught instanceof BizError && caught.status === 409) {
        conflict.value = conflictText(current, caught.message)
      } else {
        toast.error(describeError(caught))
      }
    } finally {
      busy.value = false
    }
  }

  return { open, target, busy, conflict, ask, confirm }
}
