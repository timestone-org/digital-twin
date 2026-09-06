/** @fileoverview 删除配置项前，阻止已有数据绑定静默换到另一个实体。 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { manifestBindingRows, type BindingRowInput } from './bindingReport'

/** 无法证明绑定仍指向原实体时，先解除受影响的绑定再删除。 */
export function assertConfigRemovalSafe(
  manifest: ModuleManifest | undefined,
  node: DashboardNodePayload,
  next: Record<string, unknown>,
  index: number,
): void {
  const before = manifestBindingRows({
    manifest,
    config: node.configJson,
    bindings: node.bindings,
  })
  const after = manifestBindingRows({
    manifest,
    config: next,
    bindings: node.bindings,
  })
  const beforeCounts = countsOf(before)
  const afterCounts = countsOf(after)
  const found = new Map(after.map((row) => [row.fieldKey, row]))
  const bound = new Set(node.bindings.map((one) => one.fieldKey))
  const affected = before.filter((row) => {
    if (!bound.has(row.fieldKey)) return false
    const target = found.get(row.fieldKey)
    const changedCount =
      beforeCounts.get(row.slotKey) !== afterCounts.get(row.slotKey)
    return (
      target === undefined ||
      target.entityId !== row.entityId ||
      target.label !== row.label ||
      (changedCount && row.index >= index)
    )
  })
  if (affected.length > 0)
    throw new Error(
      `删除会改变这些绑定对应的实体：${affected.map((row) => row.fieldKey).join('、')}；先读取绑定并解除受影响的槽位，再删除和重新绑定。`,
    )
}

function countsOf(rows: readonly BindingRowInput[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows)
    counts.set(row.slotKey, (counts.get(row.slotKey) ?? 0) + 1)
  return counts
}
