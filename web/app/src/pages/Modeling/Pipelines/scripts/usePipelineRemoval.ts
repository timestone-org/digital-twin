/** @fileoverview 工作流删除的确认、页面写锁与卸载后回执抑制。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'
import { deleteModelingPipeline } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

function removalAsk(name: string) {
  return {
    title: `删除「${name}」？`,
    message:
      '将删除此工作流和训练记录；存在模板、模型或部署引用时需要先处理引用。已绑定公式和当前发布模型受到保护。',
    confirmText: '删除',
    danger: true,
  }
}

export function usePipelineRemoval(isSaving: Ref<boolean>, onDone: () => void) {
  const toast = useToast()
  const confirm = useConfirm()
  let isDisposed = false
  onBeforeUnmount(() => {
    isDisposed = true
  })
  return async (row: ModelingPipelineSummary): Promise<void> => {
    if (isSaving.value || isDisposed) return
    isSaving.value = true
    try {
      if (!(await confirm.ask(removalAsk(row.name))) || isDisposed) return
      await deleteModelingPipeline(row.id)
      if (!isDisposed) {
        toast.success('已删除')
        onDone()
      }
    } catch (caught) {
      if (!isDisposed) toast.error(describeError(caught))
    } finally {
      isSaving.value = false
    }
  }
}
