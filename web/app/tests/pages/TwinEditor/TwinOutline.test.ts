/**
 * @fileoverview 契约：大纲树列出八个分组，选中 / 新增 / 显隐 / 上下移 / 复制 /
 * 删除各抛各的事件，删除必须二次确认。
 * ⚠ 两处只有肉眼能发现的坑由这里钉住：视点没有 visibility 所以那一行不许出
 * 显隐键（出了也点不出效果），删锚点的确认文案必须点名会悬空的信息牌与能量流。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinOutline from '@/pages/TwinEditor/components/TwinOutline.vue'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

function makeConfig(over: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '主机', nodes: ['n1'] }],
    anchors: [
      { id: 'a1', name: '进水温度' },
      { id: 'a2', name: '回水温度' },
    ],
    cameras: [{ id: 'c1', name: '全景' }],
    viewpoints: { items: ['c1'] },
    panels: [{ id: 'pl1', name: '牌一', anchorId: 'a1', fields: [] }],
    arrows: [{ id: 'ar1', name: '流向' }],
    flows: [{ id: 'fl1', name: '蒸汽', pathAnchors: ['a1', 'a2'] }],
    ...over,
  })
}

function mountOutline(
  config: TwinConfig = makeConfig(),
  selection: TwinSelection | null = null,
  flaggedIds: ReadonlySet<string> = new Set<string>(),
) {
  return mount(TwinOutline, { props: { config, selection, flaggedIds } })
}

type Wrapper = ReturnType<typeof mountOutline>

function rowOf(wrapper: Wrapper, id: string) {
  const row = wrapper
    .findAll('[data-test="outline-row"]')
    .find((item) => item.attributes('data-id') === id)
  if (row === undefined) throw new Error(`缺少行 ${id}`)
  return row
}

function headerOf(wrapper: Wrapper, title: string) {
  const header = wrapper
    .findAll('[data-test="outline-section"]')
    .find(
      (item) =>
        item.find('button').attributes('aria-label') === `展开或折叠${title}`,
    )
  if (header === undefined) throw new Error(`缺少分组 ${title}`)
  return header
}

describe('渲染', () => {
  it('实体段各成一节，单例段是可点的整行', () => {
    const wrapper = mountOutline()

    expect(wrapper.findAll('[data-test="outline-section"]')).toHaveLength(7)
    expect(wrapper.findAll('[data-test="outline-single"]')).toHaveLength(3)
  })

  it('单例段读得出自己的名字', () => {
    const wrapper = mountOutline()

    expect(
      wrapper.findAll('[data-test="outline-single"]')[0]?.text(),
    ).toContain('模型与场景')
    expect(
      wrapper.findAll('[data-test="outline-single"]')[1]?.text(),
    ).toContain('视点切换')
  })

  it('每一行标出文档序号，让上下移看得出改了什么', () => {
    expect(rowOf(mountOutline(), 'a2').text()).toContain('2')
  })

  it('名字空着的行显示 id，不留白', () => {
    const config = makeConfig({ anchors: [{ id: 'a1', name: '' }] })

    expect(rowOf(mountOutline(config), 'a1').text()).toContain('a1')
  })

  it('组标题上带条数', () => {
    expect(headerOf(mountOutline(), '锚点').text()).toContain('2')
  })

  it('空的组给一句占位，不是一片空白', () => {
    const wrapper = mountOutline(makeConfig({ arrows: [] }))

    expect(wrapper.text()).toContain('还没有箭头')
  })

  it('选中的行挂上选中样式', () => {
    const wrapper = mountOutline(makeConfig(), { kind: 'anchors', id: 'a2' })

    expect(rowOf(wrapper, 'a2').classes()).toContain('bg-surface-raised')
    expect(rowOf(wrapper, 'a1').classes()).not.toContain('bg-surface-raised')
  })

  it('选中单例段时只有它高亮', () => {
    const wrapper = mountOutline(makeConfig(), { kind: 'model' })
    const singles = wrapper.findAll('[data-test="outline-single"]')

    expect(singles[0]?.classes()).toContain('bg-surface-raised')
    expect(singles[1]?.classes()).not.toContain('bg-surface-raised')
  })

  it('诊断点到的行打红点', () => {
    const wrapper = mountOutline(makeConfig(), null, new Set(['a1']))

    expect(rowOf(wrapper, 'a1').find('[data-test="row-flag"]').exists()).toBe(
      true,
    )
    expect(rowOf(wrapper, 'a2').find('[data-test="row-flag"]').exists()).toBe(
      false,
    )
  })

  it('视点行不出显隐键', () => {
    const wrapper = mountOutline()

    expect(
      rowOf(wrapper, 'c1').find('[data-test="row-visible"]').exists(),
    ).toBe(false)
    expect(
      rowOf(wrapper, 'a1').find('[data-test="row-visible"]').exists(),
    ).toBe(true)
  })

  // ⚠ 没登记的图标名不报错、只是什么都不画，只能靠这一条兜
  it('分组与行上的图标都真的画出来了', () => {
    const wrapper = mountOutline()
    const spots = [
      ...wrapper.findAll('[data-test="outline-single"]'),
      ...wrapper.findAll('[data-test="outline-section"]'),
      ...wrapper.findAll('[data-test="outline-row"]'),
    ]

    expect(spots.every((spot) => spot.find('.dt-icon').exists())).toBe(true)
  })

  it('行内每个图标键都真的画出了图标', () => {
    const buttons = rowOf(mountOutline(), 'a1').findAll('button')

    expect(buttons.every((button) => button.find('.dt-icon').exists())).toBe(
      true,
    )
  })

  it('折叠一组后它的行都不再出现', async () => {
    const wrapper = mountOutline()
    const toggle = headerOf(wrapper, '锚点').find('button')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(
      wrapper
        .findAll('[data-test="outline-row"]')
        .some((row) => row.attributes('data-id') === 'a1'),
    ).toBe(false)
  })
})

describe('选中与行内动作', () => {
  it('点单例段抛的是它自己的选中值', async () => {
    const wrapper = mountOutline()

    await wrapper.findAll('[data-test="outline-single"]')[1]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([{ kind: 'viewpoints' }])
  })

  it('点一行抛 select，带集合名与 id', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a2').find('[data-test="row-select"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'anchors', id: 'a2' },
    ])
  })

  it('组标题上的「+」抛 add，带集合名', async () => {
    const wrapper = mountOutline()

    await headerOf(wrapper, '信息牌')
      .find('[data-test="section-add"]')
      .trigger('click')

    expect(wrapper.emitted('add')?.[0]).toEqual(['panels'])
  })

  it('切显隐抛 toggleVisible', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1')
      .find('[data-test="row-visible"]')
      .trigger('click')

    expect(wrapper.emitted('toggleVisible')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
  })

  it('上移抛 -1、下移抛 1', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a2').find('[data-test="row-up"]').trigger('click')
    await rowOf(wrapper, 'a1').find('[data-test="row-down"]').trigger('click')

    expect(wrapper.emitted('move')?.[0]).toEqual([
      { kind: 'anchors', id: 'a2', delta: -1 },
    ])
    expect(wrapper.emitted('move')?.[1]).toEqual([
      { kind: 'anchors', id: 'a1', delta: 1 },
    ])
  })

  it('头一行的上移与末一行的下移是禁用的', () => {
    const wrapper = mountOutline()

    expect(
      rowOf(wrapper, 'a1').find('[data-test="row-up"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      rowOf(wrapper, 'a2')
        .find('[data-test="row-down"]')
        .attributes('disabled'),
    ).toBeDefined()
  })

  it('复制抛 duplicate', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'pl1').find('[data-test="row-copy"]').trigger('click')

    expect(wrapper.emitted('duplicate')?.[0]).toEqual([
      { kind: 'panels', id: 'pl1' },
    ])
  })

  it('图标键都带 aria-label，读屏读得出是哪一行', () => {
    const row = rowOf(mountOutline(), 'a1')
    const labels = row
      .findAll('button')
      .map((button) => button.attributes('aria-label'))

    expect(labels).toContain('隐藏进水温度')
    expect(labels).toContain('删除进水温度')
  })
})

describe('删除的二次确认', () => {
  it('点一下删除只是问一句，不抛 remove', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1').find('[data-test="row-remove"]').trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(true)
  })

  it('确认之后才抛 remove', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1').find('[data-test="row-remove"]').trigger('click')
    await wrapper.find('[data-test="row-remove-yes"]').trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual([
      { kind: 'anchors', id: 'a1' },
    ])
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })

  it('取消之后确认条收起，一条事件都不抛', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1').find('[data-test="row-remove"]').trigger('click')
    await wrapper.find('[data-test="row-remove-no"]').trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.find('[data-test="row-remove-confirm"]').exists()).toBe(
      false,
    )
  })

  it('同一时刻只问一行', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1').find('[data-test="row-remove"]').trigger('click')
    await rowOf(wrapper, 'a2').find('[data-test="row-remove"]').trigger('click')

    expect(wrapper.findAll('[data-test="row-remove-confirm"]')).toHaveLength(1)
  })

  it('删锚点的确认文案点名会悬空的信息牌与能量流', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'a1').find('[data-test="row-remove"]').trigger('click')

    const text = wrapper.find('[data-test="row-remove-confirm"]').text()
    expect(text).toContain('1 张信息牌')
    expect(text).toContain('1 条能量流')
  })

  it('没人引用的实体不吓唬用户，只问删不删', async () => {
    const wrapper = mountOutline()

    await rowOf(wrapper, 'p1').find('[data-test="row-remove"]').trigger('click')

    const text = wrapper.find('[data-test="row-remove-confirm"]').text()
    expect(text).toContain('删除「主机」')
    expect(text).not.toContain('悬空')
  })
})

describe('批量建部件入口', () => {
  it('只有部件分组给批量入口——别的实体没有「一个模型节点一个」的对应关系', () => {
    const wrapper = mountOutline()

    const bulk = wrapper.findAll('[data-test="section-bulk"]')
    expect(bulk).toHaveLength(1)
  })

  it('点了抛 bulkAdd，由页面去开挑选面', async () => {
    const wrapper = mountOutline()

    await wrapper.get('[data-test="section-bulk"]').trigger('click')

    expect(wrapper.emitted('bulkAdd')).toHaveLength(1)
  })
})
