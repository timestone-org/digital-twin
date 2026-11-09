/** @fileoverview 当前页模型版本的批量下线与引用保护删除。 */
import type { ModelingVersionSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import * as modeling from '@/api/modeling'
import { deleteModelingVersion } from '@/api/modelingWorkflow'
import { useAuthStore } from '@/stores/auth'
import { useModelingBatch } from '../../scripts/useModelingBatch'

export function useVersionBatch(
  rows: () => readonly ModelingVersionSummary[],
  scope: () => string,
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const allowed = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
  const batch = useModelingBatch(
    rows,
    (row) => `${row.name} v${row.version}`,
    () => `${scope()}:${allowed.value}`,
  )
  const selection = computed<
    DtDataViewSelection<ModelingVersionSummary> | undefined
  >(() =>
    allowed.value
      ? {
          selectedIds: batch.selectedIds.value,
          disabled: batch.isBusy.value || isDisabled(),
          rowLabel: (row) => `模型 ${row.name} v${row.version}`,
        }
      : undefined,
  )
  async function remove(): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run({
      label: '批量删除模型',
      message:
        '永久删除选中的模型版本，原训练记录保留。正在部署、绑定公式或用于切换历史的版本由服务端拒绝删除，每项结果分别保留。',
      danger: true,
      action: (row) => deleteModelingVersion(row.id),
    })
    if (report !== null) await onDone()
  }
  async function retire(): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run({
      label: '批量下线模型',
      message:
        '选中模型将归档，之后可以恢复。仍有部署指向或公式绑定的版本由服务端拒绝下线，每项结果分别保留；请先切换部署、解除绑定。',
      danger: true,
      skip: (row) => ((row.archived_at ?? null) === null ? null : '模型已下线'),
      action: (row) => modeling.archiveModelingVersion(row.id),
    })
    if (report !== null) await onDone()
  }
  return { batch, selection, allowed, remove, retire }
}
