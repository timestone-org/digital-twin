/**
 * @fileoverview 素材库的状态：按类型与关键词分页列，上传、改名、删除。
 *
 * ⚠ 上传要能中止：一个几百 MB 的模型传到一半用户关掉弹窗，不中止的话它会
 * 继续跑到完，然后往一个已经卸载的组件上写状态。
 * 加载与分页在 `assetLoading.ts`（含列表的竞态防护），上传队列在
 * `assetUploads.ts`；这里只把三者接成一份对外的面。
 */
import type { AssetKind } from '@dt/contracts'
import { computed, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Asset, AssetKindSpec } from '@/api/assets'
import { deleteAsset, renameAsset } from '@/api/assets'
import { createLoader, messageOf } from './assetLoading'
import type { LibraryState, LoadMode } from './assetLoading'
import { createUploads } from './assetUploads'
import type { AssetUploads, UploadJob } from './assetUploads'

/** 取一页的动作，由 `createLoader` 造出来。 */
type Load = (kind: AssetKind, mode: LoadMode) => Promise<void>

export interface AssetLibrary {
  assets: Ref<readonly Asset[]>
  kinds: Ref<readonly AssetKindSpec[]>
  /** 当前类型的登记信息；还没加载过为 null。 */
  spec: ComputedRef<AssetKindSpec | null>
  isLoading: Ref<boolean>
  isUploading: ComputedRef<boolean>
  /** 上传队列，给界面画进度用。 */
  uploads: Ref<readonly UploadJob[]>
  finishedUploads: ComputedRef<number>
  error: Ref<string>
  /** 当前的名字关键词，只读；改它走 `search()`。 */
  keyword: Ref<string>
  /** 服务端那边还有没有下一页。 */
  hasMore: Ref<boolean>
  reload: (kind: AssetKind) => Promise<void>
  /** 换关键词并从第一页重来。 */
  search: (keyword: string) => Promise<void>
  /** 接着往下取一页。没有下一页或正在取时什么都不做。 */
  loadMore: () => Promise<void>
  upload: (kind: AssetKind, files: readonly File[]) => Promise<Asset[]>
  clearFinishedUploads: () => void
  /** 改显示名；成了回 true，失败时原因落在 `error` 上。 */
  rename: (assetId: string, name: string) => Promise<boolean>
  remove: (assetId: string) => Promise<void>
  /** 中止在途上传；关闭弹窗与卸载时都要调。 */
  abort: () => void
}

/** 会改列表内容的三个动作。 */
interface LibraryWrites {
  upload: AssetLibrary['upload']
  rename: AssetLibrary['rename']
  remove: AssetLibrary['remove']
}

function emptyState(): LibraryState {
  return {
    assets: ref<readonly Asset[]>([]),
    kinds: ref<readonly AssetKindSpec[]>([]),
    isLoading: ref(false),
    error: ref(''),
    activeKind: ref<AssetKind | null>(null),
    keyword: ref(''),
    hasMore: ref(false),
    loaded: ref(0),
  }
}

/**
 * 换关键词与往下翻页两个动作。
 * @param state 素材库状态
 * @param load 取一页
 */
function createReads(
  state: LibraryState,
  load: Load,
): Pick<AssetLibrary, 'search' | 'loadMore'> {
  return {
    search: async (keyword) => {
      const kind = state.activeKind.value
      state.keyword.value = keyword.trim()
      if (kind !== null) await load(kind, 'reset')
    },
    loadMore: async () => {
      const kind = state.activeKind.value
      if (kind === null || !state.hasMore.value || state.isLoading.value) return
      await load(kind, 'append')
    },
  }
}

/**
 * 上传、改名、删除。三个都就地改列表，不重拉整页——重拉会把「加载更多」
 * 取回来的后几页悄悄丢掉。
 * @param state 素材库状态
 * @param uploads 上传队列
 */
function createWrites(
  state: LibraryState,
  uploads: AssetUploads,
): LibraryWrites {
  async function upload(
    kind: AssetKind,
    files: readonly File[],
  ): Promise<Asset[]> {
    state.error.value = ''
    const saved = await uploads.enqueue(kind, files)
    // 只把当前类型的插进列表：队列可以跨类型排，插错了那一行会在这一页里
    // 一直显示到下次刷新，而它根本不属于这一类
    if (kind === state.activeKind.value && saved.length > 0) {
      state.assets.value = [...saved, ...state.assets.value]
    }
    return saved
  }

  async function rename(assetId: string, name: string): Promise<boolean> {
    state.error.value = ''
    try {
      const saved = await renameAsset(assetId, name)
      state.assets.value = state.assets.value.map((item) =>
        item.id === assetId ? saved : item,
      )
      return true
    } catch (caught) {
      state.error.value = messageOf(caught, '改名失败')
      return false
    }
  }

  async function remove(assetId: string): Promise<void> {
    state.error.value = ''
    try {
      await deleteAsset(assetId)
      state.assets.value = state.assets.value.filter(
        (item) => item.id !== assetId,
      )
    } catch (caught) {
      state.error.value = messageOf(caught, '删除失败')
    }
  }

  return { upload, rename, remove }
}

/** 装一份素材库状态。 */
export function useAssetLibrary(): AssetLibrary {
  const state = emptyState()
  const uploads = createUploads()
  const load = createLoader(state)

  onUnmounted(uploads.abort)

  return {
    assets: state.assets,
    kinds: state.kinds,
    spec: computed(
      () =>
        state.kinds.value.find(
          (item) => item.kind === state.activeKind.value,
        ) ?? null,
    ),
    isLoading: state.isLoading,
    isUploading: uploads.isBusy,
    uploads: uploads.jobs,
    finishedUploads: uploads.finishedCount,
    error: state.error,
    keyword: state.keyword,
    hasMore: state.hasMore,
    reload: (kind) => load(kind, 'reset'),
    clearFinishedUploads: uploads.clearFinished,
    abort: uploads.abort,
    ...createReads(state, load),
    ...createWrites(state, uploads),
  }
}
