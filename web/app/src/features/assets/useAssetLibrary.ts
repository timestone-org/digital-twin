/**
 * @fileoverview 素材库的状态：按类型分页列、上传、删除。
 *
 * ⚠ 上传要能中止：一个几百 MB 的模型传到一半用户关掉弹窗，不中止的话它会
 * 继续跑到完，然后往一个已经卸载的组件上写状态。
 * 加载与分页在 `assetLoading.ts`，那一段还管着列表的竞态防护。
 */
import type { AssetKind } from '@dt/contracts'
import { computed, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Asset, AssetKindSpec } from '@/api/assets'
import { deleteAsset, uploadAsset } from '@/api/assets'
import { createLoader, messageOf } from './assetLoading'
import type { LibraryState } from './assetLoading'

export interface AssetLibrary {
  assets: Ref<readonly Asset[]>
  kinds: Ref<readonly AssetKindSpec[]>
  /** 当前类型的登记信息；还没加载过为 null。 */
  spec: ComputedRef<AssetKindSpec | null>
  isLoading: Ref<boolean>
  isUploading: Ref<boolean>
  error: Ref<string>
  /** 服务端那边还有没有下一页。 */
  hasMore: Ref<boolean>
  reload: (kind: AssetKind) => Promise<void>
  /** 接着往下取一页。没有下一页或正在取时什么都不做。 */
  loadMore: () => Promise<void>
  upload: (kind: AssetKind, file: File) => Promise<Asset | null>
  remove: (assetId: string) => Promise<void>
  /** 中止在途上传；关闭弹窗与卸载时都要调。 */
  abort: () => void
}

interface Uploader {
  upload: (kind: AssetKind, file: File) => Promise<Asset | null>
  abort: () => void
}

/** 可中止的上传。中止后既不写状态也不报错——那是用户自己关掉的。 */
function createUploader(state: LibraryState): Uploader {
  let pending: AbortController | null = null

  function abort(): void {
    pending?.abort()
    pending = null
    state.isUploading.value = false
  }

  async function upload(kind: AssetKind, file: File): Promise<Asset | null> {
    abort()
    const controller = new AbortController()
    pending = controller
    state.isUploading.value = true
    state.error.value = ''
    try {
      const saved = await uploadAsset(kind, file, file.name, controller.signal)
      if (controller.signal.aborted) return null
      // 新的在前，与服务端的排序一致；不重拉列表是为了不闪一下
      state.assets.value = [saved, ...state.assets.value]
      return saved
    } catch (caught) {
      if (controller.signal.aborted) return null
      state.error.value = messageOf(caught, '上传失败，请重试')
      return null
    } finally {
      if (pending === controller) {
        pending = null
        state.isUploading.value = false
      }
    }
  }

  return { upload, abort }
}

/** 装一份素材库状态。 */
export function useAssetLibrary(): AssetLibrary {
  const state: LibraryState = {
    assets: ref<readonly Asset[]>([]),
    kinds: ref<readonly AssetKindSpec[]>([]),
    isLoading: ref(false),
    isUploading: ref(false),
    error: ref(''),
    activeKind: ref<AssetKind | null>(null),
    hasMore: ref(false),
    loaded: ref(0),
  }
  const uploader = createUploader(state)
  const load = createLoader(state)

  async function loadMore(): Promise<void> {
    const kind = state.activeKind.value
    if (kind === null || !state.hasMore.value || state.isLoading.value) return
    await load(kind, 'append')
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

  onUnmounted(uploader.abort)

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
    isUploading: state.isUploading,
    error: state.error,
    hasMore: state.hasMore,
    reload: (kind) => load(kind, 'reset'),
    loadMore,
    upload: uploader.upload,
    remove,
    abort: uploader.abort,
  }
}
