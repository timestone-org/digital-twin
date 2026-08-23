/**
 * @fileoverview 试算面的契约。
 *
 * ⚠ **旧结果绝不配新公式**：公式一改，上一次的那个数就得从界面上消失，否则它
 * 看着像刚给这条新公式算出来的（docs/DATASET_DESIGN.md §7.6）。
 * ⚠ 试算**不读历史**，回执里的 `history_refs` 必须照实说出来；空着不说等于让人
 * 以为那几项真的算了。
 * ⚠ 空结果不是「算错了」：要说清是**哪几列**没填才让它变空。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetFormulaPreview } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import FormulaTrial from '@/pages/Dataset/TableDetail/components/FormulaTrial.vue'

const COLUMNS = [
  {
    key: 'inflow',
    name: '进水量',
    unit: 'm³',
    data_type: 'number' as const,
    source: 'point' as const,
  },
]

function preview(over: Partial<DatasetFormulaPreview> = {}) {
  return {
    is_ok: true,
    value: 12.5,
    error: null,
    missing: [],
    should_suggest_sum: false,
    history_refs: [],
    ...over,
  } satisfies DatasetFormulaPreview
}

beforeEach(() => {
  vi.spyOn(dataset, 'previewDatasetFormula').mockResolvedValue(preview())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

function open(over: Record<string, unknown> = {}) {
  return mount(FormulaTrial, {
    props: {
      tableId: 't1',
      columnKey: 'ratio',
      formula: '{inflow} * 2',
      sameRow: ['inflow'],
      columns: COLUMNS,
      ready: true,
      unit: 'm³',
      ...over,
    },
  })
}

type Trial = ReturnType<typeof open>

async function run(wrapper: Trial): Promise<void> {
  await wrapper.get('button').trigger('click')
  await flushPromises()
}

describe('样例值', () => {
  it('只列公式真的引用到的本表列，名字与单位取自目录', () => {
    const wrapper = open()
    expect(wrapper.text()).toContain('进水量')
    expect(wrapper.get('input').attributes('placeholder')).toBe('m³')
  })

  it('目录取不到时退回列 key，而不是什么都不显示', () => {
    expect(open({ columns: [] }).text()).toContain('inflow')
  })

  it('填得成数就按数发，否则原样当文本', async () => {
    const wrapper = open()
    await wrapper.get('input').setValue('3.5')
    await run(wrapper)
    expect(dataset.previewDatasetFormula).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ values: { inflow: 3.5 } }),
      expect.anything(),
    )
  })

  it('留空即「这一列没有值」，不往上发一个空串', async () => {
    const wrapper = open()
    await run(wrapper)
    expect(dataset.previewDatasetFormula).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ values: {} }),
      expect.anything(),
    )
  })

  it('公式还没校验通过时不给试算', () => {
    const wrapper = open({ ready: false })
    expect(wrapper.text()).toContain('公式校验通过之后才能试算')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
})

describe('结果', () => {
  it('算出来多少就报多少，带上这一列的单位', async () => {
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('12.5')
    expect(wrapper.text()).toContain('m³')
  })

  it('⚠ 空不是算错了，要说清是哪几列没填', async () => {
    vi.mocked(dataset.previewDatasetFormula).mockResolvedValue(
      preview({ value: null, missing: ['inflow'] }),
    )
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('结果：空')
    expect(wrapper.text()).toContain('进水量')
  })

  it('纯加法被缺失弄空时才提议改用 SUM', async () => {
    vi.mocked(dataset.previewDatasetFormula).mockResolvedValue(
      preview({ value: null, missing: ['inflow'], should_suggest_sum: true }),
    )
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('改用 SUM')
  })

  it('⚠ 读历史的那些引用要照实说是按空算的', async () => {
    vi.mocked(dataset.previewDatasetFormula).mockResolvedValue(
      preview({ history_refs: ["SUM_OVER(inflow, '1d')"] }),
    )
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('试算不读历史')
    expect(wrapper.text()).toContain("SUM_OVER(inflow, '1d')")
  })

  it('后端说算不出来就照说，不假装有个数', async () => {
    vi.mocked(dataset.previewDatasetFormula).mockResolvedValue(
      preview({ is_ok: false, value: null, error: '除数为 0' }),
    )
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('除数为 0')
  })

  it('请求本身失败说的是「试算失败」，不是一个假的结果', async () => {
    vi.mocked(dataset.previewDatasetFormula).mockRejectedValue(new Error('x'))
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).not.toContain('结果：')
  })
})

describe('陈旧结果', () => {
  it('⚠ 公式一改，上一次那个数立刻从界面上消失', async () => {
    const wrapper = open()
    await run(wrapper)
    expect(wrapper.text()).toContain('12.5')

    await wrapper.setProps({ formula: '{inflow} * 3' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('12.5')
  })

  it('改回原样时那次结果仍然算数：它本来就是这条公式的', async () => {
    const wrapper = open()
    await run(wrapper)
    await wrapper.setProps({ formula: '{inflow} * 3' })
    await wrapper.setProps({ formula: '{inflow} * 2' })
    await flushPromises()
    expect(wrapper.text()).toContain('12.5')
  })
})
