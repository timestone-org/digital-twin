/**
 * @fileoverview 守 data-table 整块的渲染：标题走共用面板、表头与数据行都摆得出来、
 * 逐格四档在格子里各画各的、命中规则的那一格拿规则的颜色、截断与重列各有一句说明、
 * 空态两句分得开、点某一行上抛它配置里的名称，以及行的 `key` 不是下标。
 *
 * ⚠ 逐格四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 列宽模板只在根节点上落一次，表头与数据行都读同一个变量——两处各拼一份就会错列。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/data-table/Component.vue'
import {
  CELL_MARKS,
  CELL_SLOT_KEY,
  cellFieldKey,
  TABLE_COLUMNS_KEY,
  TABLE_NO_COLUMN_TEXT,
  TABLE_ROWS_KEY,
  TABLE_RULES_KEY,
} from '../../../src/modules/data-table/cells'
import manifest from '../../../src/modules/data-table/manifest'
import { configDefaults } from '../../../src/shared/config'

const DEFAULTS = configDefaults(manifest.configSchema)

type Slots = Record<string, ModuleSlotMeta>

const TWO_COLUMNS = [
  { key: 'c1', name: '功率', unit: 'kW', precision: 1 },
  { key: 'c3', name: '效率', unit: '%', precision: 0 },
]

const TWO_ROWS = [{ name: '1# 机' }, { name: '2# 机' }]

function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Slots,
) {
  return mount(Component, {
    props: {
      config: {
        ...DEFAULTS,
        [TABLE_COLUMNS_KEY]: TWO_COLUMNS,
        [TABLE_ROWS_KEY]: TWO_ROWS,
        ...config,
      },
      values,
      ...(slots === undefined ? {} : { meta: { slots } }),
    },
  })
}

/** 注入袋：逐行一个记录。 */
function readings(...rows: Record<string, unknown>[]): Record<string, unknown> {
  return { [CELL_SLOT_KEY]: rows }
}

describe('骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', () => {
    const titled = render({ title: '逆变器矩阵' })
    const bare = render()

    expect(titled.text()).toContain('逆变器矩阵')
    expect(bare.find('.module-title-bar').exists()).toBe(false)
  })

  it('表头摆出行名列与逐列的列名', () => {
    const heads = render()
      .findAll('.dtb-headcell')
      .map((cell) => cell.text())

    expect(heads).toEqual(['名称', '功率', '效率'])
  })

  it('列名留空时表头显示列键，好让人对得上绑点面板', () => {
    const heads = render({ [TABLE_COLUMNS_KEY]: [{ key: 'c4' }] })
      .findAll('.dtb-headcell')
      .map((cell) => cell.text())

    expect(heads).toEqual(['名称', 'c4'])
  })

  it('关掉表头之后整行不出', () => {
    expect(render({ showHeader: false }).find('.dtb-head').exists()).toBe(false)
  })

  it('行名列画的是配置里的行名，没起名的按「第 N 行」', () => {
    const names = render({ [TABLE_ROWS_KEY]: [{ name: '甲' }, {}] })
      .findAll('.dtb-name')
      .map((cell) => cell.text())

    expect(names).toEqual(['甲', '第 2 行'])
  })

  it('列宽模板只在根节点上落一次，表头与数据行都读它', () => {
    const wrapper = render()

    expect(wrapper.find('.dtb').attributes('style')).toContain('--dtb-cols-tpl')
    expect(wrapper.find('.dtb-head').exists()).toBe(true)
    expect(wrapper.findAll('.dtb-row')).toHaveLength(2)
  })
})

describe('逐格四档', () => {
  const SLOTS: Slots = {
    [cellFieldKey(0, 'c1')]: { state: 'ok' },
    [cellFieldKey(0, 'c3')]: { state: 'pending' },
    [cellFieldKey(1, 'c1')]: { state: 'error', message: '表被删了' },
  }

  it('四档各画各的记号，一档都不留白', () => {
    const cells = render({}, readings({ c1: 12.34 }, {}), SLOTS)
      .findAll('.dtb-cell')
      .map((cell) => cell.text())

    expect(cells).toEqual([
      '12.3 kW',
      CELL_MARKS.pending,
      CELL_MARKS.error,
      CELL_MARKS.unbound,
    ])
  })

  it('四档各挂各的修饰类，颜色因此分得开', () => {
    const classes = render({}, readings({ c1: 12.34 }, {}), SLOTS).findAll(
      '.dtb-cell',
    )

    expect(classes[0]?.classes()).toContain('dtb-cell--ok')
    expect(classes[1]?.classes()).toContain('dtb-cell--pending')
    expect(classes[2]?.classes()).toContain('dtb-cell--error')
    expect(classes[3]?.classes()).toContain('dtb-cell--unbound')
  })

  it('取不到那一格把原因挂进悬停提示，正常的那一格没有提示', () => {
    const cells = render({}, readings({ c1: 12.34 }, {}), SLOTS).findAll(
      '.dtb-cell',
    )

    expect(cells[2]?.attributes('title')).toContain('表被删了')
    expect(cells[0]?.attributes('title')).toBeUndefined()
  })

  it('对齐逐列挂类，数值列右对齐才逐行对得齐', () => {
    const cells = render({
      [TABLE_COLUMNS_KEY]: [
        { key: 'c1', align: 'left' },
        { key: 'c2', align: 'right' },
      ],
    }).findAll('.dtb-cell')

    expect(cells[0]?.classes()).toContain('dtb--align-left')
    expect(cells[1]?.classes()).toContain('dtb--align-right')
  })
})

describe('值规则', () => {
  const RULES = [
    { column: 'c3', op: 'lt', value: 90, level: 'danger', label: '效率偏低' },
  ]

  it('命中的那一格拿规则的颜色，没命中的不写行内色', () => {
    const cells = render(
      { [TABLE_RULES_KEY]: RULES },
      readings({ c1: 80, c3: 80 }),
      {
        [cellFieldKey(0, 'c1')]: { state: 'ok' },
        [cellFieldKey(0, 'c3')]: { state: 'ok' },
      },
    ).findAll('.dtb-cell')

    expect(cells[0]?.attributes('style')).toBeUndefined()
    expect(cells[1]?.attributes('style')).toContain('color')
    expect(cells[1]?.attributes('title')).toBe('效率偏低')
  })

  it('规则要闪的那一格挂闪烁类', () => {
    const cells = render(
      { [TABLE_RULES_KEY]: [{ ...RULES[0], blink: true }] },
      readings({ c3: 80 }),
      { [cellFieldKey(0, 'c3')]: { state: 'ok' } },
    ).findAll('.dtb-cell')

    expect(cells[1]?.classes()).toContain('dtb-cell--blink')
  })
})

describe('空态与说明', () => {
  it('一列都没启用与一行都没配各出各的一句', () => {
    const noColumn = render({ [TABLE_COLUMNS_KEY]: [] })
    const noRow = render({ [TABLE_ROWS_KEY]: [], emptyText: '未接设备' })

    expect(noColumn.find('.dtb-empty').text()).toBe(TABLE_NO_COLUMN_TEXT)
    expect(noRow.find('.dtb-empty').text()).toBe('未接设备')
    expect(noRow.find('.dtb-scroll').exists()).toBe(false)
  })

  it('格子都还没绑不算空：整张表照画', () => {
    const wrapper = render()

    expect(wrapper.find('.dtb-empty').exists()).toBe(false)
    expect(wrapper.findAll('.dtb-row')).toHaveLength(2)
  })

  it('截断时表下面写明一共几行，不静默少画', () => {
    const wrapper = render({
      maxRows: 1,
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
    })

    expect(wrapper.findAll('.dtb-row')).toHaveLength(1)
    expect(wrapper.find('.dtb-note').text()).toContain('共 3 行')
  })

  it('列键重复也写一句说明', () => {
    const wrapper = render({
      [TABLE_COLUMNS_KEY]: [{ key: 'c1' }, { key: 'c1' }],
    })

    expect(wrapper.find('.dtb-note').text()).toContain('列键重复')
  })

  it('没截断也没重列时一句说明都不出', () => {
    expect(render().find('.dtb-note').exists()).toBe(false)
  })
})

describe('联动', () => {
  it('点一行上抛它配置里的名称', async () => {
    const wrapper = render()

    await wrapper.findAll('.dtb-row')[1]?.trigger('click')

    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: '2# 机' }],
    ])
  })

  it('没起名的行点了不上抛，也不挂可点的样子', async () => {
    const wrapper = render({ [TABLE_ROWS_KEY]: [{}] })
    const row = wrapper.findAll('.dtb-row')[0]

    await row?.trigger('click')

    expect(wrapper.emitted('interaction')).toBeUndefined()
    expect(row?.classes()).not.toContain('dtb-row--pick')
  })
})

describe('行的 key', () => {
  it('删掉中间一行之后，留下的两行还是原来那两行', async () => {
    const wrapper = render({
      [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
    })

    await wrapper.setProps({
      config: {
        ...DEFAULTS,
        [TABLE_COLUMNS_KEY]: TWO_COLUMNS,
        [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '丙' }],
      },
    })

    expect(wrapper.findAll('.dtb-name').map((cell) => cell.text())).toEqual([
      '甲',
      '丙',
    ])
  })
})
