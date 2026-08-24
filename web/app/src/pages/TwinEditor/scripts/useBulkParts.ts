/**
 * @fileoverview 从左栏打开批量建部件弹窗，并提供模型节点候选。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { TwinConfig } from '@dt/twin-config'

import { bulkPartCandidates, type BulkPartCandidate } from './bulkParts'

export interface BulkParts {
  open: Ref<boolean>
  /** 模型节点配上「已被谁认领」。 */
  candidates: ComputedRef<readonly BulkPartCandidate[]>
  /** 从左栏按钮开。 */
  openBlank: () => void
}

/**
 * 装上批量建部件。
 * @param config 取当前配置；null = 还没读出来
 * @param modelNodes 取模型里的全部节点名
 */
export function useBulkParts(
  config: () => TwinConfig | null,
  modelNodes: () => readonly string[],
): BulkParts {
  const open = ref(false)

  return {
    open,
    candidates: computed(() => {
      const current = config()
      return current === null ? [] : bulkPartCandidates(current, modelNodes())
    }),

    openBlank: () => {
      open.value = true
    },
  }
}
