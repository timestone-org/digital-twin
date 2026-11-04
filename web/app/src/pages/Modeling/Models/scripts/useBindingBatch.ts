/** @fileoverview 当前页公式绑定的批量启停与解除。 */
import type { ModelingBinding } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import * as modeling from '@/api/modeling'
import { useAuthStore } from '@/stores/auth'
import { useModelingBatch } from '../../scripts/useModelingBatch'
import type { ModelingBatchAction } from '../../scripts/modelingBatch'

function buildActivation(
  enabled: boolean,
): ModelingBatchAction<ModelingBinding> {
  return {
    label: enabled ? '批量启用绑定' : '批量停用绑定',
    message: enabled
      ? '启用选中的公式绑定，引用这些公式的台账列将使用固定模型版本计算。'
      : '停用选中的公式绑定，引用这些公式的台账列将暂时无法取得模型计算值。',
    danger: !enabled,
    skip: (row) =>
      row.is_enabled === enabled ? `绑定已${enabled ? '启用' : '停用'}` : null,
    action: (row) =>
      modeling.updateModelingBinding(row.id, { is_enabled: enabled }),
  }
}

export function useBindingBatch(
  rows: () => readonly ModelingBinding[],
  scope: () => string,
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const allowed = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
  const batch = useModelingBatch(
    rows,
    (row) => row.fx_code,
    () => `${scope()}:${allowed.value}`,
  )
  const selection = computed<DtDataViewSelection<ModelingBinding> | undefined>(
    () =>
      allowed.value
        ? {
            selectedIds: batch.selectedIds.value,
            disabled: batch.isBusy.value || isDisabled(),
            rowLabel: (row) => `公式绑定 ${row.fx_code}`,
          }
        : undefined,
  )
  async function toggle(enabled: boolean): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run(buildActivation(enabled))
    if (report !== null) await onDone()
  }
  async function unbind(): Promise<void> {
    if (!allowed.value || isDisabled()) return
    const report = await batch.run({
      label: '批量解除绑定',
      message:
        '解除选中公式与模型的绑定。公式条目本身保留，引用它们的台账列将提示模型未绑定并取不到数。',
      danger: true,
      action: (row) => modeling.deleteModelingBinding(row.id),
    })
    if (report !== null) await onDone()
  }
  return { batch, selection, allowed, toggle, unbind }
}
