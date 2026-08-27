/**
 * @fileoverview 绑点面板的挑点状态：按关键字与数据源找采集点位。
 * ⚠ 关键字是被连着敲出来的，每一次都会发一个请求——不防竞态的话，
 * 先发后回的那次会把结果覆盖成上一个关键字的，且没有任何报错。
 * ⚠ 数据源清单只用来筛选与认人，取不到也不该挡住挑点：那时退化成
 * 「只能按关键字搜」，而不是整个面板空着。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { CollectPoint, CollectSource, DtSelectOption } from '@dt/contracts'

import { listPoints, listSources, type PointQuery } from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { protocolLabel } from '@/features/collect/protocols'

/**
 * 一次最多列这么多点位；再多就该靠关键字缩小范围。
 * ⚠ 导出是为了让界面能把「只列了前几个」说成一个具体的数：写成两份字面量时，
 * 改了这里而没改那句话，提示语会开始骗人。
 */
export const POINT_PICKER_PAGE_SIZE = 50

/** 数据源是业务级别的数量，一次拉够，不值得为它做翻页。 */
const SOURCE_PAGE_SIZE = 200

/** 数据源筛选里的「不限」那一档。 */
export const ANY_SOURCE = ''

export interface PointPicker {
  keyword: Ref<string>
  sourceId: Ref<string>
  items: Ref<CollectPoint[]>
  /**
   * 符合条件的点位一共有多少个。
   * ⚠ 它与 `items.length` 不是一回事：一页只列 `POINT_PICKER_PAGE_SIZE` 个，
   * 两者对不上就是「还有没列出来的」。不摆出这个数，用户会以为看到的就是全部，
   * 在清单里找一个明明存在的点位，怎么也找不到。
   */
  total: Ref<number>
  /** 这一页有没有列全。 */
  hasMore: ComputedRef<boolean>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 数据源筛选的档位：「全部数据源」加每个源一档，档上带它跑的协议。 */
  sourceOptions: ComputedRef<DtSelectOption[]>
  /** 数据源清单没取到的原因；取到了是 null。 */
  sourceError: Ref<string | null>
  /** 按当前关键字与数据源重新找。 */
  search: () => Promise<void>
  /** 拉一次数据源清单：筛选与结果行上的归属都靠它。 */
  loadSources: () => Promise<void>
  /** 一个点位归哪个数据源；清单里没有这个源时给空串。 */
  sourceName: (sourceId: string) => string
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

/**
 * 数据源那一半：筛选的档位、结果行上的归属，以及拉不到时的原因。
 * ⚠ 与点位搜索分开：数据源清单是筛选与认人用的，不是挑点的前置条件，
 * 它失败时只该退化成「只能按关键字搜」。
 */
function useSourceList() {
  const sources = ref<readonly CollectSource[]>([])
  const sourceError = ref<string | null>(null)

  async function loadSources(): Promise<void> {
    sourceError.value = null
    try {
      const page = await listSources({ size: SOURCE_PAGE_SIZE })
      sources.value = page.items
    } catch (caught) {
      sources.value = []
      sourceError.value = describeError(caught)
    }
  }

  return {
    sourceError,
    loadSources,
    sourceOptions: computed<DtSelectOption[]>(() => [
      { value: ANY_SOURCE, label: '全部数据源' },
      ...sources.value.map((one) => ({
        value: one.id,
        // 协议摆在档位上：以后同一套面板里会同时躺着几种协议的数据源，
        // 只写名字的话，「这个源到底是从哪读的」就没地方看了
        label: `${one.name} · ${protocolLabel(one.protocol)}`,
      })),
    ]),
    sourceName: (id: string) =>
      sources.value.find((one) => one.id === id)?.name ?? '',
  }
}

/**
 * 当前筛选条件 → 列点位的查询面。
 * ⚠ 没填的档一律给 `undefined`：把空串传下去是「筛一个叫空串的数据源」，
 * 后端老实照办，界面上表现为「一个点位都搜不到」而不是一个报错。
 * @param keyword 关键字
 * @param sourceId 数据源；`ANY_SOURCE` 表示不筛
 */
function pointQuery(keyword: string, sourceId: string): PointQuery {
  const trimmed = keyword.trim()
  return {
    q: trimmed === '' ? undefined : trimmed,
    sourceId: sourceId === ANY_SOURCE ? undefined : sourceId,
    page: 1,
    size: POINT_PICKER_PAGE_SIZE,
  }
}

export function usePointPicker(): PointPicker {
  const keyword = ref('')
  const sourceId = ref(ANY_SOURCE)
  const items = ref<CollectPoint[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const raced = useRacedFetch()
  const sourceList = useSourceList()

  async function search(): Promise<void> {
    loading.value = true
    error.value = null
    await raced.run(
      (signal) => listPoints(pointQuery(keyword.value, sourceId.value), signal),
      {
        ok: (page) => {
          items.value = page.items
          total.value = page.total
        },
        fail: (caught) => {
          error.value = describeError(caught)
          items.value = []
          total.value = 0
        },
        settled: () => (loading.value = false),
      },
    )
  }

  return {
    keyword,
    sourceId,
    items,
    total,
    hasMore: computed(() => total.value > items.value.length),
    loading,
    error,
    search,
    dispose: raced.cancel,
    ...sourceList,
  }
}
