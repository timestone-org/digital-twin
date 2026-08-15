/**
 * @fileoverview 点位绑定页签的动作：读、存、解绑、立刻下发一次。
 *
 * ⚠ 换实例要立刻换掉节点清单，而换清单是一次异步请求——**必须防竞态**：
 * 连点两个实例时，先发的那次可能后回来，把 B 的清单换成 A 的，而用户看到的
 * 实例名是 B。这里用一个自增的世代号挡住，回来时世代对不上就整份丢弃。
 */
import type {
  AcModelPublication,
  OpcuaInstance,
  OpcuaNode,
} from '@dt/contracts'

import * as hvac from '@/api/hvac'
import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
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
  // 节点清单的防竞态世代号，见文件头
  let generation = 0

  async function loadNodes(instanceId: string): Promise<void> {
    generation += 1
    const mine = generation
    const found = await fetchNodes(state, instanceId)
    // ⚠ 回来时世代对不上就整份丢弃：这一份属于上一个实例
    if (mine !== generation) return
    apply(state, found)
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
  state.isLoading.value = true
  state.error.value = null
  try {
    state.instances.value = await listInstances()
    state.saved.value = await readPublication(modelId)
    state.draft.value =
      state.saved.value === null
        ? emptyDraft()
        : draftOf(state.saved.value, derived.servingKeys.value)
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
    // 心跳落在配置行上，下发完要连它一起刷新
    state.saved.value = await readPublication(modelId)
    return true
  } catch (caught) {
    state.error.value = describeError(caught)
    return false
  } finally {
    state.isPublishing.value = false
  }
}

async function listInstances(): Promise<readonly OpcuaInstance[]> {
  const page = await opcua.listInstances({ page: 1, size: INSTANCE_LIMIT })
  return page.items
}

/**
 * 读已保存的配置。⚠ 没配过是 404，**那是正常状态不是错误**——按错误处理会让
 * 一个还没配过的模型顶着一条红色横幅。
 * @param modelId 模型 id
 */
async function readPublication(
  modelId: string,
): Promise<AcModelPublication | null> {
  try {
    return await hvac.getModelPublication(modelId)
  } catch {
    return null
  }
}
