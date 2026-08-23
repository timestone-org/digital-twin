/**
 * @fileoverview 工具箱的契约：**每一栏都由后端目录驱动，前端零函数名单**。
 *
 * ⚠ 参考实现早期在前端硬编码了五个函数名，后端补上对数与三角一族之后整族在
 * 界面上不可见，用户报的是「算不了 ln」（docs/DATASET_DESIGN.md §5.3）。这里用
 * 一份**故意与内置目录毫无重合**的假目录：任何硬编码都会当场露馅。
 * ⚠ 目录把同一类的几个运算符写在一格里（`>  >=  <  <=`），照原样插进去就是语法
 * 错误，故必须拆开。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetFormulaCatalog } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import * as dataset from '@/api/dataset'
import FormulaToolbox from '@/pages/Dataset/TableDetail/components/FormulaToolbox.vue'

// ⚠ 名字全是编出来的：真实引擎里没有 ZORK，硬编码一份名单的话它一个都出不来
const CATALOG: DatasetFormulaCatalog = {
  categories: [
    { value: 'zork', label: '编造分类' },
    { value: 'empty', label: '空分类' },
  ],
  functions: [
    {
      name: 'ZORKIFY',
      category: 'zork',
      signature: 'ZORKIFY(x)',
      description: '把 x 扭一下；带括号的这半句不该出现在小字里',
      example: 'ZORKIFY({a})',
      args: ['x'],
      min_args: 1,
      max_args: 1,
    },
    {
      name: 'ZORK_OVER',
      category: 'zork',
      signature: "ZORK_OVER({列}, '7d')",
      description: '一段时间内扭了几次',
      example: "ZORK_OVER({a}, '7d')",
      args: ['列', '时间范围'],
      min_args: 2,
      max_args: 2,
    },
  ],
  operators: [
    { value: '+', label: '加' },
    { value: '>  >=  <  <=', label: '比较' },
  ],
  window_units: [{ value: '7d', label: '7 天' }],
  rules: ['编造的一条规则'],
  columns: [
    {
      key: 'a',
      name: '甲列',
      unit: 'm³',
      data_type: 'number',
      source: 'point',
    },
    {
      key: 'b',
      name: '乙列',
      unit: null,
      data_type: 'number',
      source: 'manual',
    },
  ],
  tables: [],
  library: [],
}

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

function open(over: Partial<DatasetFormulaCatalog> = {}, selection = '') {
  return mount(FormulaToolbox, {
    props: {
      catalog: { ...CATALOG, ...over },
      used: new Set(['a']),
      selection,
    },
  })
}

type Toolbox = ReturnType<typeof open>

interface Payload {
  snippet: string
  caret: number
}

/** ⚠ 用窄化收口而不是 `as`：断言过的话，形状对不上时这条用例照样绿。 */
function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null) return false
  return 'snippet' in value && 'caret' in value
}

function payloads(wrapper: Toolbox): Payload[] {
  const events = wrapper.emitted('insert') ?? []
  return events.flatMap((one) => (isPayload(one[0]) ? [one[0]] : []))
}

async function clickTitled(wrapper: Toolbox, title: string): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((one) => one.attributes('title') === title)
  if (button === undefined) throw new Error(`没有 title 为「${title}」的按钮`)
  await button.trigger('click')
}

describe('本表的列', () => {
  it('列与单位都来自目录', () => {
    const text = open().text()
    expect(text).toContain('甲列')
    expect(text).toContain('m³')
    expect(text).toContain('乙列')
  })

  it('已引用过的列另加一道标记，不只是变个颜色', () => {
    expect(open().findAll('.ftb-chip--used')).toHaveLength(1)
  })

  it('点一下插 {列key}', async () => {
    const wrapper = open()
    await clickTitled(wrapper, '插入 {a}，单位 m³')
    expect(payloads(wrapper)[0]).toEqual({ snippet: '{a}', caret: 3 })
  })

  it('一列都没有时说一句，而不是留一片空白', () => {
    expect(open({ columns: [] }).text()).toContain('这张台账还没有别的列')
  })
})

describe('函数', () => {
  it('⚠ 目录里有几个就出几个，名字一个都不写死', async () => {
    const wrapper = open()
    await wrapper.get('summary').trigger('click')
    expect(wrapper.text()).toContain('ZORKIFY')
    expect(wrapper.text()).toContain('ZORK_OVER')
    expect(wrapper.text()).toContain('函数（2 个')
  })

  it('分类顺序照目录给的来；一个函数都没有的分类不给筛选钮', () => {
    const wrapper = open()
    expect(wrapper.text()).toContain('编造分类')
    expect(wrapper.text()).not.toContain('空分类')
  })

  it('⚠ 分类不在目录里的函数收进「其它」，不许整族消失', () => {
    const wrapper = open({ categories: [] })
    expect(wrapper.text()).toContain('其它')
    expect(wrapper.text()).toContain('ZORKIFY')
    expect(wrapper.text()).toContain('ZORK_OVER')
  })

  it('元数写进悬停说明，且是后端注入的那一份', () => {
    const wrapper = open()
    const chip = wrapper
      .findAll('button')
      .find((one) => one.text().startsWith('ZORKIFY'))
    expect(chip?.attributes('title')).toContain('（1 个参数）')
    expect(chip?.attributes('title')).toContain('例：ZORKIFY({a})')
  })

  it('⚠ 时间窗那一档预填的窗口取自签名，不是前端挑的默认值', async () => {
    const wrapper = open()
    const chip = wrapper
      .findAll('button')
      .find((one) => one.text().startsWith('ZORK_OVER'))
    await chip?.trigger('click')
    expect(payloads(wrapper)[0]?.snippet).toBe("ZORK_OVER(, '7d')")
  })

  it('有选中内容时说清会套住它', () => {
    expect(open({}, '{a} + {b}').text()).toContain('将套住选中的内容')
  })

  it('搜到了直接回车插第一个匹配项，不用再挪去点', async () => {
    const wrapper = open()
    const box = wrapper.get('input')
    await box.setValue('扭了几次')
    await box.trigger('keydown.enter')
    expect(payloads(wrapper)[0]?.snippet).toBe("ZORK_OVER(, '7d')")
  })

  it('一个都没搜到时回车不插东西，也不报错', async () => {
    const wrapper = open()
    const box = wrapper.get('input')
    await box.setValue('根本没有的函数')
    await box.trigger('keydown.enter')
    expect(payloads(wrapper)).toEqual([])
  })

  it('按分类筛只留那一类', async () => {
    const wrapper = open({
      categories: [
        { value: 'zork', label: '编造分类' },
        { value: 'other', label: '另一类' },
      ],
      functions: [
        ...CATALOG.functions,
        {
          name: 'BLORP',
          category: 'other',
          signature: 'BLORP(x)',
          description: '另一类里的',
          example: 'BLORP({a})',
          args: ['x'],
          min_args: 1,
          max_args: 1,
        },
      ],
    })
    const chip = wrapper
      .findAll('.ftb-cat')
      .find((one) => one.text() === '另一类')
    await chip?.trigger('click')
    expect(wrapper.text()).toContain('BLORP')
    expect(wrapper.text()).not.toContain('ZORKIFY')
  })

  it('搜不到时说清搜的是什么词', async () => {
    const wrapper = open()
    await wrapper.get('input').setValue('对数')
    await flushPromises()
    expect(wrapper.text()).toContain('没有匹配「对数」的函数')
  })
})

describe('运算符与时间窗', () => {
  it('⚠ 挤在一格里的比较符要拆开，否则插进去就是语法错误', () => {
    const labels = open()
      .findAll('.ftb-op')
      .map((one) => one.text())
    expect(labels).toEqual(['+', '>', '>=', '<', '<=', "'7d'"])
  })

  it('运算符两侧补空格', async () => {
    const wrapper = open()
    await clickTitled(wrapper, '加')
    expect(payloads(wrapper)[0]?.snippet).toBe(' + ')
  })

  it('时间窗字面量带引号', async () => {
    const wrapper = open()
    await clickTitled(wrapper, '7 天')
    expect(payloads(wrapper)[0]?.snippet).toBe("'7d'")
  })
})

describe('公式库与规则', () => {
  it('目录给空表时这一栏整段不出现，界面不替后端排期', () => {
    expect(open().text()).not.toContain('公式库')
  })

  it('目录里有库公式就自动出现，点一下插 @标识()', async () => {
    const wrapper = open({ library: ['tce'] })
    await clickTitled(wrapper, '插入 @tce()')
    expect(payloads(wrapper)[0]).toEqual({ snippet: '@tce()', caret: 5 })
  })

  it('求值规则也来自目录，不在前端另抄一份', () => {
    expect(open().text()).toContain('编造的一条规则')
  })
})

describe('跨表引用', () => {
  it('没有别的台账时整段不出现', () => {
    expect(open().text()).not.toContain('其他台账的列')
  })

  it('⚠ 取不到对方的列只丢跨表引用，其余照常', async () => {
    vi.spyOn(dataset, 'listDatasetTables').mockRejectedValue(new Error('boom'))
    const wrapper = open({ tables: [{ code: 'water', name: '水量台账' }] })
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'water')
    await flushPromises()
    expect(wrapper.text()).toContain('跨表引用只能手写')
    expect(wrapper.text()).toContain('甲列')
  })
})
