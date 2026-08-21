/**
 * @fileoverview 契约：钻取字段列表的增删改上下移，以及摘要靠**勾**不靠手填 key。
 * ⚠ 删字段时必须把它从摘要勾选里一并摘掉，否则会留下一个指不到任何字段的 key，
 * 而那一行只会安静地不出现。
 */
import { normalizeTwinConfig, type TwinHierNode } from '@dt/twin-config'
import { DtCheckbox } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import HierFieldList from '@/pages/TwinEditor/components/fields/HierFieldList.vue'

function nodeOf(raw: Record<string, unknown>): TwinHierNode {
  const node = normalizeTwinConfig({ hierNodes: [raw] }).hierNodes[0]
  if (node === undefined) throw new Error('造不出节点')
  return node
}

const THREE_FIELDS = {
  id: 'pump',
  fields: [
    { key: 'p', label: '功率' },
    { key: 'q', label: '流量' },
    { key: 'r', label: '温度' },
  ],
}

function render(
  raw: Record<string, unknown> = THREE_FIELDS,
  rowOffset?: number,
) {
  return mount(HierFieldList, {
    props:
      rowOffset === undefined
        ? { node: nodeOf(raw) }
        : { node: nodeOf(raw), rowOffset },
  })
}

type Wrapper = ReturnType<typeof render>

function lastFields(wrapper: Wrapper): { key: string }[] {
  const events = wrapper.emitted('update:fields')
  if (!events?.length) throw new Error('没有写回字段')
  return events[events.length - 1]?.[0] as { key: string }[]
}

function lastSummary(wrapper: Wrapper): string[] {
  const events = wrapper.emitted('update:summaryFieldKeys')
  if (!events?.length) throw new Error('没有写回摘要勾选')
  return events[events.length - 1]?.[0] as string[]
}

function summaryBoxes(wrapper: Wrapper) {
  return wrapper
    .findAllComponents(DtCheckbox)
    .filter((item) => item.props('label') === '进父层摘要卡片')
}

describe('字段增删改', () => {
  it('添加字段时键不与既有的重', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="hier-field-add"]').trigger('click')

    expect(lastFields(wrapper).map((item) => item.key)).toEqual([
      'p',
      'q',
      'r',
      'f4',
    ])
  })

  it('删字段', async () => {
    const wrapper = render()

    await wrapper
      .findAll('[data-test="hier-field-remove"]')[1]
      ?.trigger('click')

    expect(lastFields(wrapper).map((item) => item.key)).toEqual(['p', 'r'])
  })

  it('删字段时把它从摘要勾选里一并摘掉', async () => {
    const wrapper = render({ ...THREE_FIELDS, summaryFieldKeys: ['q', 'r'] })

    await wrapper
      .findAll('[data-test="hier-field-remove"]')[1]
      ?.trigger('click')

    expect(lastSummary(wrapper)).toEqual(['r'])
  })

  it('上下移换的是文档序，行号跟着变', async () => {
    const wrapper = render()

    await wrapper.findAll('button[title="下移字段"]')[0]?.trigger('click')

    expect(lastFields(wrapper).map((item) => item.key)).toEqual(['q', 'p', 'r'])
  })

  it('行号带上本节点之前已有多少行，让人看得见全局位次', () => {
    expect(render(THREE_FIELDS, 10).text()).toContain('第 11 行')
  })

  it('没给 rowOffset 时不假装知道全局位次', () => {
    expect(render().text()).toContain('本节点第 1 行')
  })

  it('键重了当场警告——重名的两行会抢同一份实时值', () => {
    const wrapper = render({
      id: 'pump',
      fields: [{ key: 'p' }, { key: 'p' }],
    })

    expect(wrapper.text()).toContain('字段键重复')
  })
})

describe('摘要勾选', () => {
  it('勾一个字段写回它的 key', async () => {
    const wrapper = render()

    await summaryBoxes(wrapper)[1]?.setValue(true)

    expect(lastSummary(wrapper)).toEqual(['q'])
  })

  it('勾选按字段次序落库，摘要卡片上的先后才与列表一致', async () => {
    const wrapper = render({ ...THREE_FIELDS, summaryFieldKeys: ['r'] })

    await summaryBoxes(wrapper)[0]?.setValue(true)

    expect(lastSummary(wrapper)).toEqual(['p', 'r'])
  })

  it('取消勾选把它摘掉', async () => {
    const wrapper = render({ ...THREE_FIELDS, summaryFieldKeys: ['p', 'q'] })

    await summaryBoxes(wrapper)[0]?.setValue(false)

    expect(lastSummary(wrapper)).toEqual(['q'])
  })

  it('一个都没勾时把「取前两个」这条回落说出来', () => {
    expect(render().text()).toContain('取前 2 个字段')
  })

  it('勾过之后就不再提回落', () => {
    expect(
      render({ ...THREE_FIELDS, summaryFieldKeys: ['p'] }).text(),
    ).not.toContain('取前 2 个字段')
  })

  it('一个字段都没有时给行内空态：单行、不带图标', () => {
    const wrapper = render({ id: 'pump', fields: [] })

    const empty = wrapper.get('.dt-empty--inline')
    expect(empty.text()).toContain('这一层还没有字段')
    expect(empty.find('svg').exists()).toBe(false)
  })
})

describe('空态', () => {
  it('一个字段都没有时说清后果', () => {
    expect(render({ id: 'pump' }).text()).toContain('只有名字没有读数')
  })
})
