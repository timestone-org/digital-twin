/**
 * @fileoverview 函数目录的取数：函数、分类、运算符、时间窗写法、求值规则，
 * 外加这张台账可引用的列与可跨表引用的台账。
 *
 * ⚠ 目录取不到**不是错误状态**：编辑器退化成一个纯文本域 + 后端校验照常，
 * 绝不把弹窗判成加载失败（docs/DATASET_DESIGN.md §7.13）。所以这里只留一句
 * 说明文案，不往上抛。
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import type { DatasetFormulaCatalog } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

export interface FormulaCatalogState {
  catalog: Ref<DatasetFormulaCatalog | null>
  loading: Ref<boolean>
  /** 取不到时的一句说明；有它也照样能写公式。 */
  failure: Ref<string>
  load: () => Promise<void>
}

/**
 * 装上一份函数目录。
 * @param tableId 取台账 id；它跟着弹窗打开的那张表走，故是个函数
 */
export function useFormulaCatalog(tableId: () => string): FormulaCatalogState {
  const catalog = ref<DatasetFormulaCatalog | null>(null)
  const loading = ref(false)
  const failure = ref('')
  const raced = useRacedFetch()

  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    await raced.run(
      (signal) => dataset.getDatasetFormulaCatalog(tableId(), signal),
      {
        ok: (result) => {
          catalog.value = result
          failure.value = ''
        },
        fail: (caught) => {
          catalog.value = null
          failure.value = describeError(caught)
        },
        settled: () => (loading.value = false),
      },
    )
  }

  onScopeDispose(() => raced.cancel())

  return { catalog, loading, failure, load }
}
