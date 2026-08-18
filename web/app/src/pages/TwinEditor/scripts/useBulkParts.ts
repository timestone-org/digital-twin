/**
 * @fileoverview 批量建部件的开关与预勾：从左栏按钮开、或从视口框选开。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { TwinConfig } from '@dt/twin-config'

import { bulkPartCandidates, type BulkPartCandidate } from './bulkParts'

export interface BulkParts {
  open: Ref<boolean>
  /** 模型节点配上「已被谁认领」。 */
  candidates: ComputedRef<readonly BulkPartCandidate[]>
  /** 打开时先替用户勾上的那些。 */
  preselect: Ref<readonly string[]>
  /** 从左栏按钮开。 */
  openBlank: () => void
  /** 从视口框选开，勾的正是框中的那些。 */
  openWith: (names: readonly string[]) => void
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
  const preselect = ref<readonly string[]>([])

  return {
    open,
    preselect,
    candidates: computed(() => {
      const current = config()
      return current === null ? [] : bulkPartCandidates(current, modelNodes())
    }),

    // ⚠ 清掉上一次框选的预勾：不清的话从按钮打开会莫名带着一批已勾中的
    openBlank: () => {
      preselect.value = []
      open.value = true
    },

    openWith: (names) => {
      preselect.value = names
      open.value = true
    },
  }
}
