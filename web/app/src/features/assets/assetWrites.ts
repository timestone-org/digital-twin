/**
 * @fileoverview 素材库里会改列表内容的那几个动作：上传、改名、重压、删除。
 *
 * 从 `useAssetLibrary.ts` 分出来是为了把那个组合式压回 200 行的闸；
 * 这里一条状态都不持有，只按传进来的那份 state 就地改。
 */
import type { AssetKind } from '@dt/contracts'

import type { Asset } from '@/api/assets'
import { deleteAsset, recompressAsset, renameAsset } from '@/api/assets'
import { messageOf } from './assetLoading'
import type { LibraryState } from './assetLoading'
import type { AssetUploads } from './assetUploads'

/** 会改列表内容的四个动作。 */
export interface LibraryWrites {
  upload: (kind: AssetKind, files: readonly File[]) => Promise<Asset[]>
  rename: (assetId: string, name: string) => Promise<boolean>
  recompress: (assetId: string) => Promise<Asset | null>
  remove: (assetId: string) => Promise<void>
}

/**
 * 调一次会换掉某一行的接口，成了就地替换那一行。
 *
 * ⚠ 就地换而不是重拉整页：重拉会把「加载更多」取回来的后几页悄悄丢掉，
 * 而用户看到的是「怎么又只剩第一页了」。
 * @param state 素材库状态
 * @param assetId 要换的那一行
 * @param call 真正去调的那个接口
 * @param fallback 认不出异常时说什么
 */
async function patchOne(
  state: LibraryState,
  assetId: string,
  call: () => Promise<Asset>,
  fallback: string,
): Promise<Asset | null> {
  state.error.value = ''
  try {
    const saved = await call()
    state.assets.value = state.assets.value.map((item) =>
      item.id === assetId ? saved : item,
    )
    return saved
  } catch (caught) {
    state.error.value = messageOf(caught, fallback)
    return null
  }
}

/**
 * 上传、改名、重压、删除。都就地改列表，不重拉整页。
 * @param state 素材库状态
 * @param uploads 上传队列
 */
export function createWrites(
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

  const rename = async (assetId: string, name: string): Promise<boolean> =>
    (await patchOne(
      state,
      assetId,
      () => renameAsset(assetId, name),
      '改名失败',
    )) !== null

  const recompress = (assetId: string): Promise<Asset | null> =>
    patchOne(state, assetId, () => recompressAsset(assetId), '排压缩队列失败')

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

  return { upload, rename, recompress, remove }
}
