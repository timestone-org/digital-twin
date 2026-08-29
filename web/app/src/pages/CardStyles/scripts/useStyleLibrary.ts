/**
 * @fileoverview 样式库这一页的取数与增删改：列表、存、删。
 *
 * ⚠ 列表一次拉满而不分页：样式是几十条量级的配置资产，分页只会把左栏那份
 * 「内置 + 我的」的分组名单切成两半。
 */
import type { CardStyle, ModuleManifest } from '@dt/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'

import * as api from '@/api/cardStyles'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { LibraryEntry } from './libraryEntries'
import { savedEntry } from './libraryEntries'
import type { StyleDraft } from './styleDraft'
import { fillStyleKeys } from './styleDraft'

/** 一次拉多少条。⚠ 与后端单页上限对齐，超了就得真分页。 */
const LIST_SIZE = 200

/** 状态摊成一只袋子传给下面几个动作，好让每个动作单独可读、也不超行数闸。 */
interface LibraryState {
  styles: Ref<CardStyle[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  saving: Ref<boolean>
  raced: RacedFetch
  onError: (message: string) => void
}

export interface StyleLibrary {
  styles: Ref<CardStyle[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  saving: Ref<boolean>
  /** 用户样式归一成的条目。 */
  savedEntries: ComputedRef<LibraryEntry[]>
  reload: () => Promise<void>
  /** 存当前草稿，返回落库那一条的 id。 */
  save: (draft: StyleDraft, manifest: ModuleManifest | null) => Promise<string>
  remove: (styleId: string) => Promise<void>
}

/**
 * 草稿 → 入参。
 * ⚠ 观感键在这里**补全**：套用是浅合并，样式里少写一个键，上一套留在
 * `config_json` 里的取值就原样残留，而用户不可能记得写全三十个键
 * （CARD_STYLE_LIBRARY_DESIGN §2.2）。
 * @param draft 当前草稿
 * @param manifest 草稿绑的那个模块的清单
 */
function toInput(
  draft: StyleDraft,
  manifest: ModuleManifest | null,
): api.CardStyleInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    moduleType: draft.moduleType,
    chrome: draft.chrome,
    config:
      draft.moduleType === null ? {} : fillStyleKeys(manifest, draft.config),
  }
}

/** 整表重取。@param state 状态袋 */
async function reload(state: LibraryState): Promise<void> {
  state.loading.value = true
  state.error.value = null
  await state.raced.run(
    (signal) => api.listCardStyles({ size: LIST_SIZE }, signal),
    {
      ok: (page) => {
        state.styles.value = page.items
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
      },
      settled: () => {
        state.loading.value = false
      },
    },
  )
}

/**
 * 存一条。新建走 POST、已有走 PATCH；成功后整表重取，左栏立刻对上。
 * @param state 状态袋
 * @param draft 当前草稿
 * @param manifest 草稿绑的那个模块的清单
 */
async function save(
  state: LibraryState,
  draft: StyleDraft,
  manifest: ModuleManifest | null,
): Promise<string> {
  state.saving.value = true
  try {
    const input = toInput(draft, manifest)
    const saved =
      draft.id === null
        ? await api.createCardStyle(input)
        : await api.updateCardStyle(draft.id, input)
    await reload(state)
    return saved.id
  } catch (caught) {
    state.onError(describeError(caught))
    throw caught
  } finally {
    state.saving.value = false
  }
}

/** 删一条。@param state 状态袋 @param styleId 样式 id */
async function remove(state: LibraryState, styleId: string): Promise<void> {
  try {
    await api.deleteCardStyle(styleId)
    await reload(state)
  } catch (caught) {
    state.onError(describeError(caught))
    throw caught
  }
}

/**
 * 装配样式库的状态。须在 setup 内调用。
 * @param onError 一句能给用户看的失败原因；由页面决定弹吐司还是画在栏里
 */
export function useStyleLibrary(
  onError: (message: string) => void,
): StyleLibrary {
  const state: LibraryState = {
    styles: shallowRef<CardStyle[]>([]),
    loading: ref(false),
    error: ref<string | null>(null),
    saving: ref(false),
    // 连点左栏会触发第二次加载：慢的那次后返回会覆盖快的那次，且不报任何错
    raced: useRacedFetch(),
    onError,
  }
  // ⚠ 不作废在飞的那一次，它返回时会写进一个已经没人看的状态
  onBeforeUnmount(state.raced.cancel)

  return {
    styles: state.styles,
    loading: state.loading,
    error: state.error,
    saving: state.saving,
    savedEntries: computed(() => state.styles.value.map(savedEntry)),
    reload: () => reload(state),
    save: (draft, manifest) => save(state, draft, manifest),
    remove: (styleId) => remove(state, styleId),
  }
}
