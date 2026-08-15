/**
 * @fileoverview 点位绑定页签的组装：状态 + 派生量 + 动作 + 几个选择动作。
 *
 * 状态在 `publicationState.ts`，动作在 `publicationActions.ts`。
 */
import { watch } from 'vue'
import type { AcModel } from '@dt/contracts'

import { emptyDraft } from '@/features/hvac/publication'
import { createPublicationActions } from './publicationActions'
import { createPublicationState, derive } from './publicationState'

/**
 * 点位绑定页签的全部状态与动作。
 * @param modelId 当前模型 id
 * @param model 当前模型；服务组合从它来
 */
export function usePublication(
  modelId: () => string,
  model: () => AcModel | null,
) {
  const state = createPublicationState()
  const derived = derive(state, model)
  const actions = createPublicationActions(state, derived, modelId)

  // 换实例就换节点清单
  watch(
    () => state.draft.value.instanceId,
    (instanceId) => {
      void actions.loadNodes(instanceId)
    },
  )

  /** 选实例。⚠ 换实例必须清掉已选的点位：那些 node_id 属于旧实例。 */
  function selectInstance(instanceId: string): void {
    if (state.draft.value.instanceId === instanceId) return
    state.draft.value = {
      ...emptyDraft(),
      instanceId,
      isEnabled: state.draft.value.isEnabled,
    }
  }

  function selectRecommendationNode(nodeId: string): void {
    state.draft.value = { ...state.draft.value, recommendationNodeId: nodeId }
  }

  function selectSetNode(setKey: string, nodeId: string): void {
    state.draft.value = {
      ...state.draft.value,
      setNodes: { ...state.draft.value.setNodes, [setKey]: nodeId },
    }
  }

  function setEnabled(isEnabled: boolean): void {
    state.draft.value = { ...state.draft.value, isEnabled }
  }

  return {
    ...state,
    ...derived,
    ...actions,
    selectInstance,
    selectRecommendationNode,
    selectSetNode,
    setEnabled,
  }
}

export type PublicationController = ReturnType<typeof usePublication>
