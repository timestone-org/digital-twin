/** @fileoverview 历史实例当前页的批量训练提交与可恢复归档。 */
import type { ModelingInstance } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import * as api from '@/api/modelingTemplates'
import { useAuthStore } from '@/stores/auth'
import { isTraining } from '../../scripts/instancePresentation'
import { useModelingBatch } from '../../scripts/useModelingBatch'

function trainingSkip(row: ModelingInstance): string | null {
  if (row.archived_at) return '实例已归档，请先恢复'
  return isTraining(row.latest_run?.status) ? '已有训练正在进行' : null
}

function archiveSkip(
  row: ModelingInstance,
  shouldArchive: boolean,
): string | null {
  if (Boolean(row.archived_at) === shouldArchive)
    return shouldArchive ? '实例已归档' : '实例未归档，无需恢复'
  return shouldArchive && isTraining(row.latest_run?.status)
    ? '已有训练正在进行'
    : null
}

export function useInstanceBatch(
  rows: () => readonly ModelingInstance[],
  scope: () => string,
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const allowed = computed(() => auth.can([PERMISSION_CODES.modelingRun]))
  const batchScope = () => `${scope()}:${allowed.value}`
  const batch = useModelingBatch(rows, (row) => row.name, batchScope)
  const selection = computed<DtDataViewSelection<ModelingInstance> | undefined>(
    () =>
      allowed.value
        ? {
            selectedIds: batch.selectedIds.value,
            disabled: batch.isBusy.value || isDisabled(),
            rowLabel: (row) => `实例 ${row.name}`,
          }
        : undefined,
  )

  async function train(): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run({
      label: '批量提交训练',
      message:
        '逐项提交所选实例的训练。提交成功仅表示请求已受理，不代表训练完成；执行结果请查看训练记录。已归档或正在训练的实例跳过。',
      skip: trainingSkip,
      action: (row) => api.trainInstance(row.id),
    })
    if (report !== null) await onDone()
  }

  async function archive(shouldArchive: boolean): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const changeState = shouldArchive
      ? api.archiveInstance
      : api.restoreInstance
    const report = await batch.run({
      label: shouldArchive ? '批量归档实例' : '批量恢复实例',
      message: shouldArchive
        ? '归档保留实例身份、配置和历史，暂停参与建模管理。有在途训练、部署或公式引用的实例由服务端拒绝归档，各项结果分别保留。'
        : '恢复所选已归档实例，使其可以继续配置和训练。模型版本与发布入口不会自动改变。',
      danger: shouldArchive,
      skip: (row) => archiveSkip(row, shouldArchive),
      action: (row) => changeState(row.id, row.revision),
    })
    if (report !== null) await onDone()
  }
  return { batch, selection, allowed, train, archive }
}
