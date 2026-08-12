/**
 * @fileoverview 游标翻页：一次只放一页，上一页 / 下一页**替换**当前页。
 *
 * 与 `useCursorList` 同一个后端口径、两种消费方式：那边把每一页追加成一张越滚
 * 越长的表，这边同时只保留一页。行数上千的列表要的是后者——追加会让 DOM 无上限
 * 地涨，页面越翻越卡。
 *
 * ⚠ 游标是**不透明串**：只原样存下来带回去，解析它等于把后端的分页实现钉死在前端。
 * ⚠ 「上一页」只能靠客户端自己记的游标栈：游标分页没有 total、也没有反向游标，
 * 想回去只能重放来时用过的那一个。
 * ⚠ 换房间 / 换筛选必须走 `reload()`：栈里还留着上一串游标的话，翻回去落到的是
 * 另一份结果的中间，而它看着完全正常。
 */
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { CursorPage } from '@dt/contracts'

import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export interface CursorPages<TItem, TProblem> {
  items: Ref<TItem[]>
  loading: Ref<boolean>
  hasNext: Ref<boolean>
  /** 这两项由游标栈算出来，不另存一份——存两份就会有一份是错的。 */
  hasPrev: ComputedRef<boolean>
  /** 1 起的页序。游标分页没有 total，所以只说得出「第几页」，说不出「共几页」。 */
  pageNumber: ComputedRef<number>
  problem: Ref<TProblem | null>
  /** 回到第一页并清空游标栈。换房间 / 换筛选走这条。 */
  reload: () => Promise<void>
  /** 原地重取当前页。写操作之后走这条，别把人甩回第一页。 */
  refresh: () => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
}

/** 走过的每一页各自的入口游标；首项恒为 null——第一页不带 `after`。 */
type Trail = readonly (string | null)[]

interface PagesState<TItem, TProblem> {
  fetcher: (after: string | null) => Promise<CursorPage<TItem>>
  describe: (caught: unknown) => TProblem
  items: Ref<TItem[]>
  loading: Ref<boolean>
  hasNext: Ref<boolean>
  trail: Ref<Trail>
  cursor: Ref<string | null>
  problem: Ref<TProblem | null>
  raced: RacedFetch
}

/**
 * @param fetcher 按游标取一页；`null` 表示取第一页
 * @param describe 把失败翻成调用方要显示的形状——各页对错误的分诊口径不同
 */
export function useCursorPages<TItem, TProblem>(
  fetcher: (after: string | null) => Promise<CursorPage<TItem>>,
  describe: (caught: unknown) => TProblem,
): CursorPages<TItem, TProblem> {
  const state: PagesState<TItem, TProblem> = {
    fetcher,
    describe,
    // 一页也可能是两百行，深层代理没有收益；同 useCursorList
    items: shallowRef<TItem[]>([]),
    loading: ref(false),
    hasNext: ref(false),
    trail: ref<Trail>([null]),
    cursor: ref<string | null>(null),
    problem: ref<TProblem | null>(null) as Ref<TProblem | null>,
    raced: useRacedFetch(),
  }
  return {
    items: state.items,
    loading: state.loading,
    hasNext: state.hasNext,
    hasPrev: computed(() => state.trail.value.length > 1),
    pageNumber: computed(() => state.trail.value.length),
    problem: state.problem,
    reload: () => go(state, [null]),
    refresh: () => go(state, state.trail.value),
    next: () => next(state),
    prev: () => prev(state),
  }
}

// ⚠ 游标栈只在响应回来时才落位，成败都落——否则页序与屏幕上那一页会对不上
function accept<TItem, TProblem>(
  state: PagesState<TItem, TProblem>,
  page: CursorPage<TItem>,
  trail: Trail,
): void {
  state.items.value = page.items
  state.cursor.value = page.next
  state.hasNext.value = page.has_more
  state.problem.value = null
  state.trail.value = trail
}

function fail<TItem, TProblem>(
  state: PagesState<TItem, TProblem>,
  caught: unknown,
  trail: Trail,
): void {
  state.problem.value = state.describe(caught)
  state.items.value = []
  state.hasNext.value = false
  state.cursor.value = null
  state.trail.value = trail
}

/**
 * 取 `trail` 末端那一页。
 * ⚠ 这里**不拦**「取数中」：换房间与换筛选可能在同一拍里连着触发两次首屏取数，
 * 拦掉第二次就把界面停在上一个筛选的结果上。重复发起交给竞态序号收口。
 * @param trail 到目标页为止走过的游标
 */
async function go<TItem, TProblem>(
  state: PagesState<TItem, TProblem>,
  trail: Trail,
): Promise<void> {
  state.loading.value = true
  const after = trail[trail.length - 1] ?? null
  await state.raced.run(() => state.fetcher(after), {
    ok: (page) => accept(state, page, trail),
    fail: (caught) => fail(state, caught, trail),
    settled: () => (state.loading.value = false),
  })
}

/** 没有下一页、或正在取数时不重复发起。 */
async function next<TItem, TProblem>(
  state: PagesState<TItem, TProblem>,
): Promise<void> {
  const after = state.cursor.value
  if (after === null || state.loading.value) return
  await go(state, [...state.trail.value, after])
}

/** 回上一页靠重放来时那个游标，翻回去拿到的是同一批行。 */
async function prev<TItem, TProblem>(
  state: PagesState<TItem, TProblem>,
): Promise<void> {
  const trail = state.trail.value
  if (trail.length <= 1 || state.loading.value) return
  await go(state, trail.slice(0, -1))
}
