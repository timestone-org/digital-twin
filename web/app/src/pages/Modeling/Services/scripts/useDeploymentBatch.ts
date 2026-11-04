/** @fileoverview 部署入口的批量启停、修订保护与删除。 */
import type { ModelDeployment } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import * as modeling from '@/api/modeling'
import { useAuthStore } from '@/stores/auth'
import { useModelingBatch } from '../../scripts/useModelingBatch'
import { ModelingBatchRejected } from '../../scripts/modelingBatch'
import type {
  ModelingBatchAction,
  ModelingBatchContext,
} from '../../scripts/modelingBatch'

async function setEnabled(
  row: ModelDeployment,
  context: ModelingBatchContext,
  enabled: boolean,
): Promise<ModelDeployment> {
  const current =
    row.revision === undefined
      ? await context.read((signal) =>
          modeling.getModelDeployment(row.id, signal),
        )
      : row
  context.ensureActive()
  if (current.revision === undefined)
    throw new ModelingBatchRejected('服务没有返回修订号，请刷新后再操作')
  return modeling.updateModelDeployment(row.id, {
    is_enabled: enabled,
    expected_revision: current.revision,
  })
}

function buildActivation(
  enabled: boolean,
): ModelingBatchAction<ModelDeployment> {
  return {
    label: enabled ? '批量启用服务' : '批量停用服务',
    message: enabled
      ? '启用所选部署，第三方可通过现有稳定地址调用固定模型版本。'
      : '停用所选部署，第三方对这些稳定地址的模型调用将立即被拒绝，模型版本和调用记录保留。',
    danger: !enabled,
    skip: (row) =>
      row.is_enabled === enabled ? `服务已${enabled ? '启用' : '停用'}` : null,
    action: (row, context) => setEnabled(row, context, enabled),
  }
}

export function useDeploymentBatch(
  rows: () => readonly ModelDeployment[],
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const allowed = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
  const batch = useModelingBatch(
    rows,
    (row) => row.name,
    () => allowed.value,
  )
  const selection = computed<DtDataViewSelection<ModelDeployment> | undefined>(
    () =>
      allowed.value
        ? {
            selectedIds: batch.selectedIds.value,
            disabled: batch.isBusy.value || isDisabled(),
            rowLabel: (row) => `服务 ${row.name}`,
          }
        : undefined,
  )
  async function toggle(enabled: boolean): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run(buildActivation(enabled))
    if (report !== null) await onDone()
  }
  async function remove(): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run({
      label: '批量删除服务',
      message:
        '永久删除所选部署及其调用记录，第三方调用地址将立即返回不存在。模型版本本身保留；需要暂停调用时可以停用服务。',
      danger: true,
      action: (row) => modeling.deleteModelDeployment(row.id),
    })
    if (report !== null) await onDone()
  }
  return { batch, selection, allowed, toggle, remove }
}
