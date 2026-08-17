/**
 * @fileoverview 绑定页发上来的动作，落到文档态的那一份扁平绑定上。
 *
 * ⚠ 全部写入都经 `doc.commitBindings`：它把「配置 + 绑定」一起压成一帧，
 * 撤销才不会把两者错开——绕开它直接改的话，撤销一次会退回配置却留下绑定。
 * ⚠ 这里只动绑定不动配置，所以**不需要**重派绑定行；重派只在配置变了时发生
 * （见 `twinDoc.ts` 与 `remapTwinBindings`）。
 */
import type { BindingPayload } from '@dt/contracts'

import { withRowRemoved } from '@/features/dashboard/bindingSlots'
import { createBinding, sortBindings } from '@/features/dashboard/editorDoc'

import type { TwinDoc } from './twinDoc'

export interface TwinBindingActions {
  /** 写一条绑定（同 `fieldKey` 原地替换，**id 沿用旧的**）。 */
  write: (binding: BindingPayload) => void
  /** 给一个还没绑的槽建一条空绑定。 */
  bind: (fieldKey: string) => void
  /** 解除一条绑定。 */
  drop: (fieldKey: string) => void
  /**
   * 删数组槽的某一行，其后各行整体前移一格。
   * ⚠ 孪生的行与实体一一对应，所以这只用来清掉**没有对应实体的孤行**：
   * 删一行正常行会让它后面的每一条绑定改喂前一个实体，而界面上看不出来。
   */
  removeRow: (slotKey: string, rowIndex: number) => void
  /** 把挑到的点位写进某条绑定。 */
  applyPickedPoint: (fieldKey: string, pointKey: string) => void
}

/**
 * 写一条绑定：同 `fieldKey` 的原地替换，没有则追加。
 * ⚠ 沿用旧 id：重生成会让实时推送的关联键每次保存断一次
 * （与 `editorDoc.upsertBinding` 同一条口径）。
 */
function upsert(
  bindings: readonly BindingPayload[],
  binding: BindingPayload,
): BindingPayload[] {
  const existing = bindings.find((item) => item.fieldKey === binding.fieldKey)
  const merged =
    existing === undefined ? binding : { ...binding, id: existing.id }
  return sortBindings([
    ...bindings.filter((item) => item.fieldKey !== binding.fieldKey),
    merged,
  ])
}

/**
 * 挑到的点位落到哪个字段上：历史序列写 `detailJson`，其余写 `nodeKey`。
 * ⚠ 写错字段的表现是「挑完了、标签也变了，但永远取不到值」。
 */
function withPoint(
  current: BindingPayload,
  pointKey: string,
): BindingPayload {
  if (current.sourceKind !== 'archive') return { ...current, nodeKey: pointKey }
  return {
    ...current,
    detailJson: {
      nodeKey: pointKey,
      range: current.detailJson?.range ?? { lastWindow: '1h' },
    },
  }
}

/**
 * 装上绑定页的动作集。
 * @param doc 孪生文档态
 * @param nodeId 这段孪生所在的大屏节点 id；新建的绑定挂在它上面
 */
export function createTwinBindingActions(
  doc: TwinDoc,
  nodeId: () => string,
): TwinBindingActions {
  function commit(next: readonly BindingPayload[]): void {
    doc.commitBindings(next)
  }

  return {
    write: (binding) => commit(upsert(doc.bindings.value, binding)),

    bind: (fieldKey) =>
      commit(upsert(doc.bindings.value, createBinding(nodeId(), fieldKey))),

    drop: (fieldKey) =>
      commit(doc.bindings.value.filter((item) => item.fieldKey !== fieldKey)),

    removeRow: (slotKey, rowIndex) =>
      commit(withRowRemoved(doc.bindings.value, slotKey, rowIndex)),

    applyPickedPoint: (fieldKey, pointKey) => {
      const current = doc.bindings.value.find(
        (item) => item.fieldKey === fieldKey,
      )
      if (current === undefined) return
      commit(upsert(doc.bindings.value, withPoint(current, pointKey)))
    },
  }
}
