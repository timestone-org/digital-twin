/** @fileoverview 页面内渲染序列快照；验收只读此处，不另发历史请求。 */
import type { BindingView } from '@dt/contracts'
import type { BindingSlot, RuntimeDataSource } from '@dt/runtime'

export type ReadRenderedSeries = (
  nodeId: string,
  binding: BindingView,
) => BindingSlot | undefined

/** 每次发布带独立所有权，旧组件卸载不能清掉新组件的快照。 */
export function createRenderedSeries(): {
  observe: NonNullable<RuntimeDataSource['observeSeries']>
  read: ReadRenderedSeries
  clear: () => void
} {
  const nodes = new Map<
    string,
    { identity: Map<string, string>; slots: ReadonlyMap<string, BindingSlot> }
  >()
  return {
    observe: (nodeId, bindings, slots) => {
      const snapshot = {
        identity: new Map(bindings.map((one) => [one.id, JSON.stringify(one)])),
        slots,
      }
      nodes.set(nodeId, snapshot)
      return () => {
        if (nodes.get(nodeId) === snapshot) nodes.delete(nodeId)
      }
    },
    read: (nodeId, binding) => {
      const snapshot = nodes.get(nodeId)
      if (snapshot?.identity.get(binding.id) !== JSON.stringify(binding))
        return undefined
      return snapshot.slots.get(binding.fieldKey)
    },
    clear: () => nodes.clear(),
  }
}
