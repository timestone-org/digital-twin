/** @fileoverview 批量配置弹窗的两种落地：整份部件改动、批量替换草稿绑定；各为一次撤销。 */
import type { BindingPayload } from '@dt/contracts'
import type { TwinConfig } from '@dt/twin-config'

import type { TwinDoc } from './twinDoc'

/**
 * 把批量改好的配置整份写回，返回真正变了的部件数；一个都没变就不写。
 * @param doc 当前草稿
 * @param next 批量改完的配置
 */
export function applyBatchConfig(doc: TwinDoc, next: TwinConfig): number {
  const count = doc.config.value.parts.filter(
    (part) =>
      JSON.stringify(part) !==
      JSON.stringify(next.parts.find((item) => item.id === part.id)),
  ).length
  if (count > 0) doc.commit(next)
  return count
}

/**
 * 把批量替换后的绑定整份写回，返回点位真正换了的条数；一条都没换就不写。
 * @param doc 当前草稿
 * @param next 替换后的全部绑定
 */
export function applyBatchBindings(
  doc: TwinDoc,
  next: readonly BindingPayload[],
): number {
  const count = next.filter(
    (item) =>
      doc.bindings.value.find((old) => old.id === item.id)?.nodeKey !==
      item.nodeKey,
  ).length
  if (count > 0) doc.commitBindings(next)
  return count
}
