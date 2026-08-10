/**
 * @fileoverview 危险操作的二次确认（单例队列）。`DtConfirmHost` 渲染，业务侧 `await ask()`。
 *
 * 做成命令式而不是「每个页面自己摆一个弹窗组件 + 一份 open/target 状态」：
 * 后者每加一个可删对象就要复制一遍那份状态，而复制漏一处的表现是**点了删除没反应**。
 */

import { readonly, ref, type DeepReadonly, type Ref } from 'vue'

export interface DtConfirmRequest {
  title?: string
  /** 说清楚会发生什么、能不能撤销。只写「确认删除？」等于没说。 */
  message: string
  confirmText?: string
  cancelText?: string
  /** 确认按钮转危险色。删除、停用这类不可逆或影响他人的操作要开。 */
  danger?: boolean
}

interface PendingConfirm extends DtConfirmRequest {
  id: number
  settle: (confirmed: boolean) => void
}

const pending = ref<PendingConfirm | null>(null)
let sequence = 0

function settle(confirmed: boolean): void {
  const current = pending.value
  if (current === null) return
  pending.value = null
  current.settle(confirmed)
}

interface ConfirmApi {
  pending: DeepReadonly<Ref<PendingConfirm | null>>
  /** 弹出确认框，用户点「确定」时 resolve 为 true，其余一切关闭路径都是 false。 */
  ask: (request: DtConfirmRequest) => Promise<boolean>
  resolve: (confirmed: boolean) => void
}

export function useConfirm(): ConfirmApi {
  function ask(request: DtConfirmRequest): Promise<boolean> {
    // ⚠ 前一个还没结的时候直接顶掉它，并把它判为「取消」：
    // 不结的话调用方的 await 永远挂着，那条代码路径就静默停在半截。
    settle(false)
    return new Promise<boolean>((done) => {
      sequence += 1
      pending.value = { ...request, id: sequence, settle: done }
    })
  }

  return { pending: readonly(pending), ask, resolve: settle }
}
