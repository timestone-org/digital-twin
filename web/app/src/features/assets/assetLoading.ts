/**
 * @fileoverview 素材列表的分页加载：带竞态防护，按位移一页页往下取。
 *
 * ⚠ 竞态防护是必须的：类型可以被快速连点、搜索框可以一个字一个字敲，慢的那次
 * 后返回会把新条件的列表覆盖成旧条件的，而没有任何一处报错——看起来只是
 * 「点了图标却出模型」「搜索框里是 A 而列表是 B」。
 * ⚠ 服务端不回总数，所以「还有没有下一页」只能由「这一页是否取满」推断。
 */
import type { AssetKind } from '@dt/contracts'
import type { Ref } from 'vue'

import type { Asset, AssetKindSpec } from '@/api/assets'
import { listAssetKinds, listAssets } from '@/api/assets'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 一页多少条。⚠ 与服务端 `DEFAULT_PAGE_SIZE` 同值，取满才说明还有下一页。 */
export const PAGE_SIZE = 50

/** 重来一次还是接着往下取。 */
export type LoadMode = 'reset' | 'append'

/** 几个 ref 收成一包，好让加载那一段搬到模块层去写。 */
export interface LibraryState {
  assets: Ref<readonly Asset[]>
  kinds: Ref<readonly AssetKindSpec[]>
  isLoading: Ref<boolean>
  error: Ref<string>
  activeKind: Ref<AssetKind | null>
  /** 名字关键词；空串 = 不筛。⚠ 与 kind 一起构成「这一页是哪一页」。 */
  keyword: Ref<string>
  hasMore: Ref<boolean>
  /** 已从服务端取到的条数。⚠ 不用 `assets.length`：本地的上传与删除会改它。 */
  loaded: Ref<number>
}

/**
 * 把异常收敛成一句能给用户看的话。
 * @param error 抓到的东西
 * @param fallback 认不出时说什么
 */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback
}

/**
 * 类型目录只取一次：它是代码里的常量表，不会在一次会话里变。
 * @param state 素材库状态
 */
async function ensureKinds(state: LibraryState): Promise<void> {
  if (state.kinds.value.length > 0) return
  try {
    state.kinds.value = await listAssetKinds()
  } catch (caught) {
    state.error.value = messageOf(caught, '素材类型取不到')
  }
}

/**
 * 追加时按 id 去重。
 * ⚠ 上传会把新素材插在最前，而服务端那边它同样排在第一条——按位移取下一页
 * 时边界上那条会被再带回来一次。重复的 key 会让整段列表错位，而现象
 * （某一行的删除按钮删掉了别的行）与原因隔得极远。
 * @param current 已经在列表里的
 * @param rows 刚取回来的一页
 */
function appended(
  current: readonly Asset[],
  rows: readonly Asset[],
): readonly Asset[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...rows.filter((item) => !seen.has(item.id))]
}

/**
 * 造一个带竞态防护的加载器：每次领一个号，只有最后一次的结果算数。
 * @param state 素材库状态
 */
export function createLoader(
  state: LibraryState,
): (kind: AssetKind, mode: LoadMode) => Promise<void> {
  const raced = useRacedFetch()
  return async (kind, mode) => {
    state.activeKind.value = kind
    state.isLoading.value = true
    state.error.value = ''
    await ensureKinds(state)
    const offset = mode === 'append' ? state.loaded.value : 0
    const q = state.keyword.value
    await raced.run(() => listAssets(kind, { limit: PAGE_SIZE, offset, q }), {
      // 慢的那次后返回时整个丢弃：写回去就是「点了图标却出模型」
      ok: (rows) => {
        state.assets.value =
          mode === 'append' ? appended(state.assets.value, rows) : rows
        state.loaded.value = offset + rows.length
        state.hasMore.value = rows.length === PAGE_SIZE
      },
      fail: (caught) => {
        state.error.value = messageOf(caught, '素材列表取不到')
      },
      settled: () => (state.isLoading.value = false),
    })
  }
}
