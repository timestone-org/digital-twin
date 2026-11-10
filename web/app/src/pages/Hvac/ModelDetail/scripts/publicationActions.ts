/**
 * @fileoverview 点位绑定页签的动作：读、存、解绑、立刻下发一次。
 *
 * ⚠ 换实例要立刻换掉节点清单，而换清单是一次异步请求——**必须防竞态**：
 * 连点两个实例时，先发的那次可能后回来，把 B 的清单换成 A 的，而用户看到的
 * 实例名是 B。
 */
import type {
  AcModelPublication,
  OpcuaInstance,
  OpcuaNode,
} from '@dt/contracts'

import { BizError } from '@/api/client'
import * as hvac from '@/api/hvac'
import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  draftOf,
  emptyDraft,
  toPublicationInput,
} from '@/features/hvac/publication'
import type { PublicationDerived, PublicationState } from './publicationState'

/** 一次拉多少个实例 / 节点。⚠ 超了要说出来，不许静默截断。 */
const INSTANCE_LIMIT = 100
export const NODE_LIMIT = 200

export function createPublicationActions(
  state: PublicationState,
  derived: PublicationDerived,
  modelId: () => string,
) {
  const nodes = useRacedFetch()

  async function loadNodes(instanceId: string): Promise<void> {
    // ⚠ 回来时不再是最后一次就整份丢弃：这一份属于上一个实例
    await nodes.run(() => fetchNodes(state, instanceId), {
      ok: (found) => apply(state, found),
      fail: () => {},
      settled: () => {},
    })
  }

  return {
    load: () => load(state, derived, modelId()),
    loadNodes,
    save: () => save(state, derived, modelId()),
    unbind: () => unbind(state, modelId()),
    publishNow: () => publishNow(state, modelId()),
  }
}

/** 一次取数的结果：节点、有没有被截断、以及出错时的那句话。 */
interface NodeFetch {
  nodes: readonly OpcuaNode[]
  isTruncated: boolean
  error: string | null
}

async function fetchNodes(
  state: PublicationState,
  instanceId: string,
): Promise<NodeFetch> {
  if (instanceId === '') {
    return { nodes: [], isTruncated: false, error: null }
  }
  try {
    const page = await opcua.listNodes(instanceId, {
      page: 1,
      size: NODE_LIMIT,
    })
    return {
      nodes: page.items,
      isTruncated: page.total > page.items.length,
      error: state.error.value,
    }
  } catch (caught) {
    return { nodes: [], isTruncated: false, error: describeError(caught) }
  }
}

function apply(state: PublicationState, found: NodeFetch): void {
  state.nodes.value = found.nodes
  state.isNodeListTruncated.value = found.isTruncated
  state.error.value = found.error
}

async function load(
  state: PublicationState,
  derived: PublicationDerived,
  modelId: string,
): Promise<void> {
  // ⚠ 切走再切回来会再进这里：草稿有未保存的改动时重读会静默把它冲掉
  if (state.loadedFor.value === modelId && derived.isDirty.value) return
  state.isLoading.value = true
  state.error.value = null
  try {
    state.instances.value = await listInstances()
    state.saved.value = await readPublication(modelId)
    state.draft.value =
      state.saved.value === null
        ? emptyDraft()
        : draftOf(state.saved.value, derived.servingKeys.value)
    state.loadedFor.value = modelId
  } catch (caught) {
    state.error.value = describeError(caught)
  } finally {
    state.isLoading.value = false
  }
}

async function save(
  state: PublicationState,
  derived: PublicationDerived,
  modelId: string,
): Promise<boolean> {
  state.isSaving.value = true
  state.error.value = null
  try {
    state.saved.value = await hvac.putModelPublication(
      modelId,
      toPublicationInput(state.draft.value, derived.servingKeys.value),
    )
    state.draft.value = draftOf(state.saved.value, derived.servingKeys.value)
    return true
  } catch (caught) {
    state.error.value = describeError(caught)
    return false
  } finally {
    state.isSaving.value = false
  }
}

async function unbind(
  state: PublicationState,
  modelId: string,
): Promise<boolean> {
  state.isSaving.value = true
  state.error.value = null
  try {
    await hvac.deleteModelPublication(modelId)
    state.saved.value = null
    state.draft.value = emptyDraft()
    state.publishResult.value = null
    return true
  } catch (caught) {
    state.error.value = describeError(caught)
    return false
  } finally {
    state.isSaving.value = false
  }
}

async function publishNow(
  state: PublicationState,
  modelId: string,
): Promise<boolean> {
  state.isPublishing.value = true
  state.error.value = null
  try {
    state.publishResult.value = await hvac.publishModelNow(modelId)
    await refreshSaved(state, modelId)
    return true
  } catch (caught) {
    state.error.value = describeError(caught)
    return false
  } finally {
    state.isPublishing.value = false
  }
}

/**
 * 下发完重读配置：心跳落在配置行上。
 * ⚠ 重读失败保留手上那份——下发本身已经成功，清成 null 会让一个配好的模型
 * 看起来像没配过，下一次保存就整份盖掉线上的绑定。
 * @param state 页签状态
 * @param modelId 模型 id
 */
async function refreshSaved(
  state: PublicationState,
  modelId: string,
): Promise<void> {
  try {
    state.saved.value = await readPublication(modelId)
  } catch {
    // 心跳暂时是旧的，配置本身没变
  }
}

async function listInstances(): Promise<readonly OpcuaInstance[]> {
  const page = await opcua.listInstances({ page: 1, size: INSTANCE_LIMIT })
  return page.items
}

/**
 * 读已保存的配置。⚠ 没配过是 404，**那是正常状态不是错误**——按错误处理会让
 * 一个还没配过的模型顶着一条红色横幅。其余失败照样抛：当成「没配过」的话，
 * 下一次保存会整份盖掉线上那份绑定。
 * @param modelId 模型 id
 */
async function readPublication(
  modelId: string,
): Promise<AcModelPublication | null> {
  try {
    return await hvac.getModelPublication(modelId)
  } catch (caught) {
    if (caught instanceof BizError && caught.status === 404) return null
    throw caught
  }
}
