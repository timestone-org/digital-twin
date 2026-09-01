/**
 * @fileoverview 流水线列表上的建、改、删。
 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

/** 表单弹窗当前在编辑谁。`id` 为 `null` 是新建。 */
export interface PipelineDraft {
  id: string | null
  code: string
  name: string
  description: string
}

const BLANK: PipelineDraft = { id: null, code: '', name: '', description: '' }

/** 建一条或改一条。返回是否成功。 */
async function submit(input: PipelineDraft): Promise<void> {
  if (input.id === null) {
    await modeling.createModelingPipeline({
      code: input.code,
      name: input.name,
      description: input.description || null,
    })
    return
  }
  await modeling.updateModelingPipeline(input.id, {
    name: input.name,
    description: input.description || null,
  })
}

/** 删除前的问话。⚠ 要说清连带删掉什么，也说清什么不跟着删。 */
function removalAsk(name: string): {
  title: string
  message: string
  confirmText: string
  danger: boolean
} {
  return {
    title: `删除「${name}」？`,
    message:
      '这条流水线与它的全部运行记录都会删掉。已经发布出去的模型版本不受影响，仍然可以继续被台账公式引用。',
    confirmText: '删除',
    danger: true,
  }
}

function draftOf(row: ModelingPipelineSummary): PipelineDraft {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
  }
}

export function usePipelineOps(onDone: () => void) {
  const draft = ref<PipelineDraft | null>(null)
  const isSaving = ref(false)
  const toast = useToast()
  const confirm = useConfirm()

  async function save(input: PipelineDraft): Promise<void> {
    isSaving.value = true
    try {
      await submit(input)
      draft.value = null
      toast.success(input.id === null ? '流水线已建好' : '已保存')
      onDone()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      isSaving.value = false
    }
  }

  async function remove(row: ModelingPipelineSummary): Promise<void> {
    if (!(await confirm.ask(removalAsk(row.name)))) return
    try {
      await modeling.deleteModelingPipeline(row.id)
      toast.success('已删除')
      onDone()
    } catch (caught) {
      toast.error(describeError(caught))
    }
  }

  return {
    draft,
    isSaving,
    save,
    remove,
    /** 打开新建表单。 */
    openCreate: () => {
      draft.value = { ...BLANK }
    },
    /** 打开改名表单。**编码不给改**，绑定引用的就是它。 */
    openEdit: (row: ModelingPipelineSummary) => {
      draft.value = draftOf(row)
    },
    close: () => {
      draft.value = null
    },
  }
}
