/**
 * @fileoverview 模型管理页的状态：供应商清单、用途分配、两个消费方此刻的能力面。
 *
 * ⚠ 四份数据一起拉、各自失败各自说：供应商拉不到不该把用途那一栏也遮成红的，
 * 助手没部署更不该让整页空白——那时供应商与用途照常能配，只是「当前生效」
 * 那一栏写着助手没接。
 * ⚠ 取数走 `useRacedFetch`：连点两下刷新时慢的那一次后返回会盖掉快的那一次。
 */
import { computed, ref, shallowRef, type Ref } from 'vue'
import type {
  AssistantCapability,
  LlmProvider,
  LlmPurpose,
} from '@dt/contracts'

import { probeCapability } from '@/api/assistant'
import { BizError } from '@/api/client'
import { readCapability, type KnowledgeCapability } from '@/api/knowledge'
import * as llm from '@/api/llmProviders'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

/** 一次拉多少路供应商。后端上限 200，而供应商不会有这么多 */
const PAGE_SIZE = 200

/** 后端「目录没开」那一条错误码，见 platform `apps/llm_providers/errors.py`。 */
export const LLM_DISABLED_CODE = 52401

export interface ModelCatalog {
  providers: Ref<LlmProvider[]>
  purposes: Ref<LlmPurpose[]>
  assistant: Ref<AssistantCapability | null>
  knowledge: Ref<KnowledgeCapability | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  /** 目录整个没开（后端 503）：给一句指向配置项的话 */
  isDisabled: Ref<boolean>
  reload: () => Promise<void>
  /** 只重拉两个消费方的能力面（改完分配之后看它们有没有跟上） */
  reloadEffective: () => Promise<void>
  assign: (
    purpose: string,
    providerId: string,
    modelName: string,
  ) => Promise<void>
  clear: (purpose: string) => Promise<void>
  remove: (provider: LlmProvider) => Promise<void>
}

/** 页面持有的那几格状态，函数之间靠它传，不靠闭包。 */
interface State {
  providers: Ref<LlmProvider[]>
  purposes: Ref<LlmPurpose[]>
  assistant: Ref<AssistantCapability | null>
  knowledge: Ref<KnowledgeCapability | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  isDisabled: Ref<boolean>
  raced: RacedFetch
}

interface Loaded {
  providers: LlmProvider[]
  purposes: LlmPurpose[]
}

async function fetchCatalog(signal: AbortSignal): Promise<Loaded> {
  const [page, listed] = await Promise.all([
    llm.listProviders({ size: PAGE_SIZE }, signal),
    llm.listPurposes(signal),
  ])
  return { providers: page.items, purposes: listed }
}

async function reloadEffective(state: State): Promise<void> {
  // ⚠ 两个都用 allSettled：任何一个没部署都只是那一栏缺席
  const [fromAssistant, fromKnowledge] = await Promise.allSettled([
    probeCapability(),
    readCapability(),
  ])
  state.assistant.value =
    fromAssistant.status === 'fulfilled' ? fromAssistant.value : null
  state.knowledge.value =
    fromKnowledge.status === 'fulfilled' ? fromKnowledge.value : null
}

async function reload(state: State): Promise<void> {
  state.isLoading.value = true
  state.error.value = null
  await Promise.all([
    state.raced.run(fetchCatalog, {
      ok: (loaded) => {
        state.providers.value = loaded.providers
        state.purposes.value = loaded.purposes
        state.isDisabled.value = false
      },
      fail: (caught) => {
        state.isDisabled.value = isDisabledError(caught)
        state.error.value = state.isDisabled.value
          ? null
          : describeError(caught)
      },
      settled: () => (state.isLoading.value = false),
    }),
    reloadEffective(state),
  ])
}

async function assign(
  state: State,
  purpose: string,
  providerId: string,
  modelName: string,
): Promise<void> {
  const updated = await llm.assignPurpose(purpose, {
    provider_id: providerId,
    model_name: modelName,
  })
  state.purposes.value = state.purposes.value.map((one) =>
    one.purpose === purpose ? updated : one,
  )
}

async function clear(state: State, purpose: string): Promise<void> {
  await llm.clearPurpose(purpose)
  state.purposes.value = state.purposes.value.map((one) =>
    one.purpose === purpose
      ? {
          ...one,
          provider_id: null,
          provider_name: null,
          model_name: null,
          updated_at: null,
        }
      : one,
  )
}

async function remove(state: State, provider: LlmProvider): Promise<void> {
  await llm.deleteProvider(provider.id)
  state.providers.value = state.providers.value.filter(
    (one) => one.id !== provider.id,
  )
}

export function useModelCatalog(): ModelCatalog {
  const state: State = {
    providers: shallowRef<LlmProvider[]>([]),
    purposes: shallowRef<LlmPurpose[]>([]),
    assistant: shallowRef<AssistantCapability | null>(null),
    knowledge: shallowRef<KnowledgeCapability | null>(null),
    isLoading: ref(false),
    error: ref<string | null>(null),
    isDisabled: ref(false),
    raced: useRacedFetch(),
  }
  return {
    providers: state.providers,
    purposes: state.purposes,
    assistant: state.assistant,
    knowledge: state.knowledge,
    isLoading: state.isLoading,
    error: state.error,
    isDisabled: computed(() => state.isDisabled.value),
    reload: () => reload(state),
    reloadEffective: () => reloadEffective(state),
    assign: (purpose, providerId, modelName) =>
      assign(state, purpose, providerId, modelName),
    clear: (purpose) => clear(state, purpose),
    remove: (provider) => remove(state, provider),
  }
}

function isDisabledError(caught: unknown): boolean {
  // ⚠ 按码分支，不按 message：文案会改
  return caught instanceof BizError && caught.code === LLM_DISABLED_CODE
}
