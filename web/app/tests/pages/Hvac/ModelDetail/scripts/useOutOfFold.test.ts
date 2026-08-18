/**
 * @fileoverview 全量折外取数：连着翻页、命中护栏、防竞态与派生统计。
 *
 * ⚠ 组合过滤在客户端做，切组合是零请求的——用例据此断言请求次数没涨。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { ModelPrediction, Page } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import {
  foldStatsOf,
  meanAbsError,
  topErrorsOf,
} from '@/pages/Hvac/ModelDetail/scripts/foldStats'
import {
  SCATTER_MAX_ROWS,
  useOutOfFold,
  type OutOfFold,
} from '@/pages/Hvac/ModelDetail/scripts/useOutOfFold'
import { prediction } from '@/testing/modelFixtures'

/** 造一页折外预测；起始时刻互不相同，充当稳定 key。 */
function page(
  count: number,
  total: number,
  offset = 0,
  over: Partial<ModelPrediction> = {},
): Page<ModelPrediction> {
  const items = Array.from({ length: count }, (_, at) =>
    prediction({
      started_at: new Date(Date.UTC(2026, 0, 1, 0, offset + at)).toISOString(),
      ...over,
    }),
  )
  return { items, page: 1, size: 200, total }
}

/** 把 composable 挂进一个宿主组件——它要用 onBeforeUnmount。 */
function host(modelId = 'm1') {
  const filter = ref('')
  const id = ref(modelId)
  let api: OutOfFold | null = null
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useOutOfFold(
          () => id.value,
          () => filter.value,
        )
        return () => null
      },
    }),
  )
  if (api === null) throw new Error('composable 应已建立')
  return { wrapper, filter, id, api: api as OutOfFold }
}

beforeEach(() => {
  vi.spyOn(hvac, 'listModelPredictions').mockResolvedValue(page(3, 3))
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('翻页取全量', () => {
  it('一页取完就停，总数照后端报的来', async () => {
    const { api } = host()
    api.reload()
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(1)
    expect(hvac.listModelPredictions).toHaveBeenCalledWith('m1', {
      page: 1,
      size: 200,
    })
    expect(api.rows.value).toHaveLength(3)
    expect(api.total.value).toBe(3)
    expect(api.loading.value).toBe(false)
  })

  it('不够就接着翻，每页回来先补进去（渐进渲染）', async () => {
    vi.mocked(hvac.listModelPredictions)
      .mockResolvedValueOnce(page(200, 260))
      .mockResolvedValueOnce(page(60, 260, 200))
    const { api } = host()
    api.reload()
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(2)
    expect(api.rows.value).toHaveLength(260)
  })

  it('⚠ 命中 2000 条护栏就收手，脚注据此说「超出部分未画」', async () => {
    vi.mocked(hvac.listModelPredictions).mockImplementation((_id, query) =>
      Promise.resolve(page(200, 5000, ((query?.page ?? 1) - 1) * 200)),
    )
    const { api } = host()
    api.reload()
    await flushPromises()
    expect(api.rows.value).toHaveLength(SCATTER_MAX_ROWS)
    expect(api.total.value).toBe(5000)
  })

  it('模型 id 还没到手时一个请求都不发', async () => {
    const { api } = host('')
    api.reload()
    await flushPromises()
    expect(hvac.listModelPredictions).not.toHaveBeenCalled()
  })

  it('出错时不留半份点，错误说出来', async () => {
    vi.mocked(hvac.listModelPredictions).mockRejectedValue(new Error('boom'))
    const { api } = host()
    api.reload()
    await flushPromises()
    expect(api.rows.value).toEqual([])
    expect(api.error.value).toBe('请求失败，请重试')
  })

  it('⚠ 卸载后在途的循环自己退出，不再往已销毁的 ref 里塞点', async () => {
    vi.mocked(hvac.listModelPredictions)
      .mockResolvedValueOnce(page(200, 400))
      .mockResolvedValueOnce(page(200, 400, 200))
    const { wrapper, api } = host()
    api.reload()
    wrapper.unmount()
    await flushPromises()
    expect(api.rows.value).toEqual([])
  })
})

describe('派生统计', () => {
  it('切组合是纯客户端的，不再发请求', async () => {
    vi.mocked(hvac.listModelPredictions).mockResolvedValue({
      items: [
        prediction({ started_at: '2026-01-01T00:00:00.000Z' }),
        prediction({
          started_at: '2026-01-02T00:00:00.000Z',
          running_set: ['K11', 'K12'],
        }),
      ],
      page: 1,
      size: 200,
      total: 2,
    })
    const { api, filter } = host()
    api.reload()
    await flushPromises()
    expect(api.filtered.value).toHaveLength(2)
    filter.value = 'K11+K12'
    await flushPromises()
    expect(api.filtered.value).toHaveLength(1)
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(1)
  })

  it('热行 MAE 只数实际 > 0 的行；漏盖的另算', async () => {
    vi.mocked(hvac.listModelPredictions).mockResolvedValue({
      items: [
        prediction({ actual_minutes: 20, p50: 30 }),
        prediction({
          started_at: '2026-01-02T00:00:00.000Z',
          actual_minutes: 0,
          p10: 0,
          p50: 0,
          p90: 0,
        }),
        prediction({
          started_at: '2026-01-03T00:00:00.000Z',
          actual_minutes: 60,
          p10: 20,
          p50: 40,
          p90: 50,
        }),
      ],
      page: 1,
      size: 200,
      total: 3,
    })
    const { api } = host()
    api.reload()
    await flushPromises()
    expect(api.hotRows.value).toHaveLength(2)
    expect(api.hotMae.value).toBe(15)
    expect(api.missedCount.value).toBe(1)
  })
})

describe('纯函数', () => {
  it('⚠ 空集的 MAE 是 null 不是 0——「没有热行」不是「零误差」', () => {
    expect(meanAbsError([])).toBeNull()
    expect(meanAbsError([prediction({ actual_minutes: 20, p50: 25 })])).toBe(5)
  })

  it('按折汇总按折号升序，没有热行的那折 hotMae 为 null', () => {
    const stats = foldStatsOf([
      prediction({ fold: 3, actual_minutes: 20, p50: 30 }),
      prediction({ fold: 1, actual_minutes: 0, p50: 0 }),
    ])
    expect(stats.map((stat) => stat.fold)).toEqual([1, 3])
    expect(stats[0]?.hotMae).toBeNull()
    expect(stats[0]?.count).toBe(1)
    expect(stats[1]?.hotMae).toBe(10)
  })

  it('⚠ Top5 不排除零行：实际 0 却预测 40 是严重错误', () => {
    const rows = topErrorsOf([
      prediction({ started_at: 'a', actual_minutes: 0, p50: 40 }),
      prediction({ started_at: 'b', actual_minutes: 20, p50: 22 }),
    ])
    expect(rows.map((row) => row.started_at)).toEqual(['a', 'b'])
  })

  it('Top5 最多五条', () => {
    const many = Array.from({ length: 9 }, (_, at) =>
      prediction({ started_at: `x${at}`, actual_minutes: at, p50: 0 }),
    )
    expect(topErrorsOf(many)).toHaveLength(5)
  })
})
