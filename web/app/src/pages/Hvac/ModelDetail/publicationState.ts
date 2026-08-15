/**
 * @fileoverview 点位绑定页签持有的那一份状态，以及只读的派生量。
 *
 * 动作在 `publicationActions.ts`，组装在 `usePublication.ts`。
 */
import { computed, ref, shallowRef, type ComputedRef } from 'vue'
import type {
  AcModel,
  AcModelPublication,
  ModelPublishResult,
  OpcuaInstance,
  OpcuaNode,
} from '@dt/contracts'

import { formatSet } from '@/features/hvac/modelView'
import {
  emptyDraft,
  isDraftDirty,
  isDraftFullyBound,
  type PublicationDraft,
} from '@/features/hvac/publication'

export function createPublicationState() {
  return {
    draft: ref<PublicationDraft>(emptyDraft()),
    saved: shallowRef<AcModelPublication | null>(null),
    instances: shallowRef<readonly OpcuaInstance[]>([]),
    nodes: shallowRef<readonly OpcuaNode[]>([]),
    /** 节点太多被截断了。⚠ 必须说出来，静默截断会让人以为那个点位不存在。 */
    isNodeListTruncated: ref(false),
    isLoading: ref(false),
    isSaving: ref(false),
    isPublishing: ref(false),
    error: ref<string | null>(null),
    publishResult: shallowRef<ModelPublishResult | null>(null),
  }
}

export type PublicationState = ReturnType<typeof createPublicationState>

/** 只读的派生量：服务组合、脏没脏、绑齐没有。 */
export interface PublicationDerived {
  servingKeys: ComputedRef<readonly string[]>
  isDirty: ComputedRef<boolean>
  isFullyBound: ComputedRef<boolean>
}

/**
 * 从状态与当前模型算出那三个派生量。
 * @param state 页签状态
 * @param model 当前模型；服务组合从它来
 */
export function derive(
  state: PublicationState,
  model: () => AcModel | null,
): PublicationDerived {
  const servingKeys = computed(() =>
    (model()?.serving_sets ?? []).map(formatSet),
  )
  return {
    servingKeys,
    isDirty: computed(() =>
      isDraftDirty(state.draft.value, state.saved.value, servingKeys.value),
    ),
    isFullyBound: computed(() =>
      isDraftFullyBound(state.draft.value, servingKeys.value),
    ),
  }
}
