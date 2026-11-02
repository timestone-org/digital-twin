/**
 * @fileoverview 流水线列表上的创建、复制、编辑与删除。
 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { onBeforeUnmount, ref } from 'vue'

import * as modeling from '@/api/modeling'
import { newClientUuid } from '@/api/idempotency'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

import { PIPELINE_TEMPLATES } from './templates'

/** 表单弹窗当前在编辑谁。`id` 为 `null` 是新建。 */
export interface PipelineDraft {
  id: string | null
  code: string
  name: string
  description: string
  sourcePipelineId?: string
}

const BLANK: PipelineDraft = { id: null, code: '', name: '', description: '' }

/** 创建独立图副本，或保存新建与编辑表单。 */
async function submit(
  input: PipelineDraft,
  templateKey: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (input.sourcePipelineId !== undefined) {
    const source = await modeling.getModelingPipeline(
      input.sourcePipelineId,
      signal,
    )
    if (signal.aborted) return null
    const created = await modeling.createModelingPipeline({
      code: input.code,
      name: input.name.trim(),
      description: input.description || null,
      graph: structuredClone(source.graph),
    })
    return created.id
  }
  if (input.id === null) {
    // ⚠ 找不到那张模板时给空白图而不是抛：模板是前端常量，键对不上是代码问题，
    // 不该让用户的「新建」当场失败
    const template = PIPELINE_TEMPLATES.find((item) => item.key === templateKey)
    const created = await modeling.createModelingPipeline({
      code: input.code,
      name: input.name,
      description: input.description || null,
      ...(template ? { graph: template.build() } : {}),
    })
    return created.id
  }
  await modeling.updateModelingPipeline(input.id, {
    name: input.name,
    description: input.description || null,
  })
  return null
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

function usePipelineSaving(onDone: () => void) {
  const draft = ref<PipelineDraft | null>(null)
  const isSaving = ref(false)
  const toast = useToast()
  const operation = useRacedFetch()
  onBeforeUnmount(operation.cancel)

  async function save(
    input: PipelineDraft,
    templateKey = '',
  ): Promise<string | null> {
    if (isSaving.value) return null
    isSaving.value = true
    let createdId: string | null = null
    await operation.run((signal) => submit(input, templateKey, signal), {
      ok: (id) => {
        createdId = id
        draft.value = null
        toast.success(
          input.sourcePipelineId !== undefined
            ? '流水线已复制，接下来在副本中修改'
            : input.id === null
              ? '流水线已创建，接下来在流程图中配置'
              : '已保存',
        )
        onDone()
      },
      fail: (caught) => toast.error(describeError(caught)),
      settled: () => {
        isSaving.value = false
      },
    })
    return createdId
  }

  return { draft, isSaving, save }
}

export function usePipelineOps(onDone: () => void) {
  const { draft, isSaving, save } = usePipelineSaving(onDone)
  const toast = useToast()
  const confirm = useConfirm()
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
      if (isSaving.value) return
      draft.value = {
        ...BLANK,
        code: `model_${newClientUuid().slice(0, 8)}`,
      }
    },
    /** 打开改名表单。**编码不给改**，绑定引用的就是它。 */
    openEdit: (row: ModelingPipelineSummary) => {
      if (isSaving.value) return
      draft.value = draftOf(row)
    },
    openCopy: (row: ModelingPipelineSummary) => {
      if (isSaving.value) return
      draft.value = {
        ...draftOf(row),
        id: null,
        sourcePipelineId: row.id,
        code: `model_${newClientUuid().replaceAll('-', '')}`,
        name: `${Array.from(row.name).slice(0, 125).join('')} 副本`,
      }
    },
    close: () => {
      if (!isSaving.value) draft.value = null
    },
  }
}
