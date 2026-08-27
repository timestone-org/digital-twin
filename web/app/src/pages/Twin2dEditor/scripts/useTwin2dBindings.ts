/**
 * @fileoverview 2D 孪生编辑器的绑定这一路：绑定表、绑定页的四个动作，与挑点弹窗的开关。
 *
 * ⚠ 全部写入都经 `doc.commitBindings`：它把配置与绑定压成同一帧，撤销才不会把两者
 * 错开——绕开它直接改的表现是撤销一次退回了配置、绑定却停在新行号上。
 * ⚠ 这里只动绑定不动配置，所以**不**重派行号；重派只在配置变了时由 `twin2dDoc.commit`
 * 无条件做一次（`remapTwin2dBindings`，见 docs/MODULE_TWIN_2D_DESIGN.md §14.3）。
 * ⚠ 挑到的点位落库的是 `node_key`（点位在设备上的身份）不是 `code`：写成 code 的表现
 * 是标签上有点位名、推送方却永远匹配不到这个键，读数一直是占位符。
 */
import type { BindingPayload, CollectPoint } from '@dt/contracts'
import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { withRowRemoved } from '@/features/dashboard/bindingSlots'
import { createBinding, sortBindings } from '@/features/dashboard/editorDoc'

import type { Twin2dDoc } from './twin2dDoc'

export interface Twin2dBindings {
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: ComputedRef<readonly BindingPayload[]>
  /** 写一条绑定；同 `fieldKey` 原地替换，**id 沿用旧的**。 */
  write: (binding: BindingPayload) => void
  /** 给一个还没绑的槽建一条空绑定。 */
  bind: (fieldKey: string) => void
  /** 解除一条绑定。 */
  drop: (fieldKey: string) => void
  /**
   * 删数组槽的某一行，其后各行整体前移一格。
   * ⚠ 三个槽的行都与实体一一对应，所以这只用来清掉**没有对应实体的孤行**：删一行
   * 正常行只会让它后面的每一条绑定改喂前一个实体，而界面上看不出来。
   */
  removeRow: (slotKey: string, rowIndex: number) => void
  /** 正在给哪个槽挑点位；null = 挑点弹窗没开。 */
  pickingFieldKey: Ref<string | null>
  /** 挑点弹窗回来的那一下。 */
  pickPoint: (point: CollectPoint) => void
  /** 弹窗的开关回传；关上时结束这一次挑点。 */
  closePicker: (isOpen: boolean) => void
}

/**
 * 写一条绑定：同 `fieldKey` 的原地替换，没有则追加。
 * ⚠ 沿用旧 id：重生成会让实时推送的关联键每次保存断一次（与 `editorDoc.upsertBinding`
 * 同一条口径）。
 * @param bindings 当前这一份绑定
 * @param binding 要写进去的那一条
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
 * @param current 这一条绑定
 * @param pointKey 点位在设备上的身份
 */
function withPoint(current: BindingPayload, pointKey: string): BindingPayload {
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
 * 装上绑定与挑点。
 * @param doc 2D 孪生文档态；null = 还没读出来，此时全部动作都是空操作
 * @param nodeId 这段孪生所在的大屏节点 id；新建的绑定挂在它上面
 */
export function useTwin2dBindings(
  doc: () => Twin2dDoc | null,
  nodeId: () => string,
): Twin2dBindings {
  const bindings = computed<readonly BindingPayload[]>(
    () => doc()?.bindings.value ?? [],
  )
  const pickingFieldKey = ref<string | null>(null)

  /**
   * 写回文档态。带 `slotKey` 的是同一个槽的连续编辑（逐键输入、挑点覆写），按
   * (节点, 槽) 并成一笔撤销；增删这类一次性动作不传，各记各的一笔。
   * @param next 整份新绑定
   * @param slotKey 这一段连续编辑的槽键
   */
  function commit(next: readonly BindingPayload[], slotKey?: string): void {
    const key =
      slotKey === undefined ? undefined : `binding:${nodeId()}:${slotKey}`
    doc()?.commitBindings(next, key)
  }

  /**
   * 把挑到的点位写进正在挑的那一条绑定，并结束这一次挑点。
   * ⚠ 先清挑点状态再判：弹窗回来一次就该关一次，写不写得进去是另一回事。
   * @param point 弹窗里选中的采集点位
   */
  function pickPoint(point: CollectPoint): void {
    const fieldKey = pickingFieldKey.value
    pickingFieldKey.value = null
    const current = bindings.value.find((item) => item.fieldKey === fieldKey)
    if (fieldKey === null || current === undefined) return
    commit(upsert(bindings.value, withPoint(current, point.node_key)), fieldKey)
  }

  return {
    bindings,
    write: (binding) =>
      commit(upsert(bindings.value, binding), binding.fieldKey),
    bind: (fieldKey) =>
      commit(upsert(bindings.value, createBinding(nodeId(), fieldKey))),
    drop: (fieldKey) =>
      commit(bindings.value.filter((item) => item.fieldKey !== fieldKey)),
    removeRow: (slotKey, rowIndex) =>
      commit(withRowRemoved(bindings.value, slotKey, rowIndex)),
    pickingFieldKey,
    pickPoint,
    closePicker: (isOpen) => {
      if (!isOpen) pickingFieldKey.value = null
    },
  }
}
