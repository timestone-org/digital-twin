/**
 * @fileoverview 契约：数组控件的行 key 机制与行移动——key 由 `useRowKeys` 发、
 * 模板只读不写；删行、换位都连着动那把 uid，行的 DOM 身份跟着**数据**走而不是跟着
 * 下标走。key 错位的表现是撤销 / 删行之后行内本地态（焦点、草稿）静默串到别的行上。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'

import { installConfigControls } from '@/features/dashboard/configControls'
import ArrayControl from '@/features/dashboard/controls/ArrayControl.vue'

const FIELD: ConfigField = {
  key: 'items',
  label: '条目',
  type: 'array',
  itemSchema: [{ key: 'label', label: '名称', type: 'string' }],
  itemLabelKey: 'label',
}

type Row = Record<string, unknown>

function rows(...labels: string[]): Row[] {
  return labels.map((label) => ({ label }))
}

function mountArray(value: Row[], over: Partial<ConfigField> = {}) {
  return mount(ArrayControl, {
    props: { field: { ...FIELD, ...over }, value, depth: 0 },
  })
}

type Wrapper = ReturnType<typeof mountArray>

/** 第 at 行上那颗 aria-label 指定的按钮。 */
function rowButton(wrapper: Wrapper, at: number, label: string) {
  const row = wrapper.findAll('div.rounded.border')[at]
  if (row === undefined) throw new Error(`没有第 ${at} 行`)
  const button = row
    .findAll('button')
    .find((item) => item.attributes('aria-label') === label)
  if (button === undefined) throw new Error(`第 ${at} 行没有「${label}」`)
  return button
}

/** 最后一次抛出的 update。 */
function lastUpdate(wrapper: Wrapper): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

/** 给第 at 行的 DOM 元素打上外来标记：元素被 Vue 重建时标记会消失。 */
function markRow(wrapper: Wrapper, at: number, marker: string): void {
  const row = wrapper.findAll('div.rounded.border')[at]
  if (row === undefined) throw new Error(`没有第 ${at} 行`)
  row.element.setAttribute('data-probe', marker)
}

function probedText(wrapper: Wrapper, marker: string): string | null {
  const found = wrapper.find(`[data-probe="${marker}"]`)
  return found.exists() ? found.text() : null
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('行移动', () => {
  it('每行行头有上移与下移，首行禁上移、末行禁下移', () => {
    const wrapper = mountArray(rows('一', '二', '三'))

    expect(
      rowButton(wrapper, 0, '上移这一行').attributes('disabled'),
    ).toBeDefined()
    expect(
      rowButton(wrapper, 0, '下移这一行').attributes('disabled'),
    ).toBeUndefined()
    expect(
      rowButton(wrapper, 2, '下移这一行').attributes('disabled'),
    ).toBeDefined()
    expect(
      rowButton(wrapper, 1, '上移这一行').attributes('disabled'),
    ).toBeUndefined()
  })

  it('下移与相邻行交换数据，作为一次离散动作抛出', async () => {
    const wrapper = mountArray(rows('一', '二', '三'))

    await rowButton(wrapper, 0, '下移这一行').trigger('click')

    expect(lastUpdate(wrapper)).toEqual([rows('二', '一', '三'), false])
  })

  it('上移同理，方向相反', async () => {
    const wrapper = mountArray(rows('一', '二', '三'))

    await rowButton(wrapper, 2, '上移这一行').trigger('click')

    expect(lastUpdate(wrapper)).toEqual([rows('一', '三', '二'), false])
  })

  it('整控件禁用时移动与删除全部禁用', () => {
    const wrapper = mount(ArrayControl, {
      props: {
        field: FIELD,
        value: rows('一', '二'),
        depth: 0,
        disabled: true,
      },
    })

    for (const label of ['上移这一行', '下移这一行', '删除这一行']) {
      expect(
        rowButton(wrapper, 1, label).attributes('disabled'),
        label,
      ).toBeDefined()
    }
  })

  // ⚠ key 不跟着换位走的话，Vue 会在原元素里就地换内容——行内本地态（焦点、
  //   IME 草稿）留在原地，等于「移动了数据、丢下了状态」
  it('换位后行的 DOM 身份跟着数据走，不是原地换内容', async () => {
    const wrapper = mountArray(rows('一', '二'))
    markRow(wrapper, 0, 'row-one')

    await rowButton(wrapper, 0, '下移这一行').trigger('click')
    const [next] = lastUpdate(wrapper)
    await wrapper.setProps({ value: next })

    expect(probedText(wrapper, 'row-one')).toContain('一')
    expect(wrapper.findAll('div.rounded.border')[1]?.text()).toContain('一')
  })
})

describe('行内编辑', () => {
  it('改一格只动那一行，按连续输入抛出整表', async () => {
    const wrapper = mountArray(rows('一', '二'))
    const inputs = wrapper.findAll('input.dt-input__el')

    await inputs[1]?.setValue('二改')

    expect(lastUpdate(wrapper)).toEqual([rows('一', '二改'), true])
  })

  it('行数据是脏值（非对象）时照常渲染，不把面板打崩', () => {
    const wrapper = mount(ArrayControl, {
      props: { field: FIELD, value: ['一串字' as unknown as Row], depth: 0 },
    })

    expect(wrapper.findAll('div.rounded.border')).toHaveLength(1)
  })
})

describe('删行与 key 对齐', () => {
  // ⚠ 删行必须连着删那把 uid：只按长度截尾的话，被删行之后的每一行都会
  //   领到前一行的 key，Vue 复用错元素——本地态整体错位
  it('删中间一行，其余行的 DOM 身份原地保住', async () => {
    const wrapper = mountArray(rows('一', '二', '三'))
    markRow(wrapper, 1, 'row-two')
    markRow(wrapper, 2, 'row-three')

    await rowButton(wrapper, 0, '删除这一行').trigger('click')
    const [next] = lastUpdate(wrapper)
    expect(next).toEqual(rows('二', '三'))
    await wrapper.setProps({ value: next })

    expect(probedText(wrapper, 'row-two')).toContain('二')
    expect(probedText(wrapper, 'row-three')).toContain('三')
  })

  it('外部整包替换（撤销 / 重做）行数复原时照常渲染，key 按位置续用', async () => {
    const wrapper = mountArray(rows('一', '二', '三'))

    // 模拟：删第 2 行 → 撤销把三行原样放回来
    await rowButton(wrapper, 1, '删除这一行').trigger('click')
    await wrapper.setProps({ value: rows('一', '三') })
    await wrapper.setProps({ value: rows('一', '二', '三') })

    const labels = wrapper
      .findAll('div.rounded.border')
      .map((row) => row.text())
    expect(labels[0]).toContain('一')
    expect(labels[1]).toContain('二')
    expect(labels[2]).toContain('三')
  })

  it('新增一行不动已有行的 DOM 身份', async () => {
    const wrapper = mountArray(rows('一'))
    markRow(wrapper, 0, 'row-one')

    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('新增一行'))
    await add?.trigger('click')
    const [next] = lastUpdate(wrapper)
    expect(next).toEqual([{ label: '一' }, {}])
    await wrapper.setProps({ value: next })

    expect(probedText(wrapper, 'row-one')).toContain('一')
    expect(wrapper.findAll('div.rounded.border')).toHaveLength(2)
  })
})
