/**
 * @fileoverview 契约：视点切换检查器把「空清单 = 全部显示」摆在明面上。
 *
 * ⚠ `items` 空数组不是「一个都不显示」，而是按 `cameras` 的文档序全显示；
 * 不说清楚的话，用户勾空清单之后会以为自己已经把控件藏起来了。
 * ⚠ 清单里挑到不存在的视点会静默不显示，所以只许从 `cameras` 里勾，
 * 删过视点留下的悬空 id 单独报出来。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinCamera, TwinViewpointSwitcher } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ViewpointsInspector from '@/pages/TwinEditor/components/inspector/ViewpointsInspector.vue'

const CONFIG = normalizeTwinConfig({
  cameras: [
    { id: 'c1', name: '全景' },
    { id: 'c2', name: '俯视' },
    { id: 'c3', name: '' },
  ],
})

const CAMERAS: readonly TwinCamera[] = CONFIG.cameras

function makeSwitcher(
  over: Record<string, unknown> = {},
): TwinViewpointSwitcher {
  return normalizeTwinConfig({ viewpoints: { enabled: true, ...over } })
    .viewpoints
}

function mountSwitcher(
  modelValue: TwinViewpointSwitcher = makeSwitcher(),
  cameras: readonly TwinCamera[] = CAMERAS,
) {
  return mount(ViewpointsInspector, { props: { modelValue, cameras } })
}

type Wrapper = ReturnType<typeof mountSwitcher>

function lastSwitcher(wrapper: Wrapper): TwinViewpointSwitcher {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回视点切换')
  return events[events.length - 1]?.[0] as TwinViewpointSwitcher
}

function switchByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAll('button[role="switch"]')
    .find((item) => item.text() === label)
  if (!found) throw new Error(`没有名为「${label}」的开关`)
  return found
}

function checkboxAt(wrapper: Wrapper, index: number) {
  const found = wrapper.findAll('input[type="checkbox"]')[index]
  if (!found) throw new Error(`没有第 ${index} 个勾选框`)
  return found
}

function iconButton(wrapper: Wrapper, label: string) {
  const found = wrapper.find(`button[aria-label="${label}"]`)
  if (!found.exists()) throw new Error(`没有「${label}」`)
  return found
}

describe('空清单这一档', () => {
  it('清单为空时说明它是「全部显示」而不是「一个都不显示」', () => {
    const wrapper = mountSwitcher()

    expect(
      switchByLabel(wrapper, '全部显示（按视点列表的顺序）').text(),
    ).toContain('全部显示')
    expect(wrapper.text()).toContain('没有「一个都不显示」这一档')
  })

  it('要整个藏起来得关掉切换控件，界面上指明这条路', () => {
    const wrapper = mountSwitcher()

    expect(wrapper.text()).toContain('要整个藏起来请关掉上面的切换控件')
  })

  it('关掉「全部显示」时把现有视点铺进清单，不留一个空清单', async () => {
    const wrapper = mountSwitcher()

    await switchByLabel(wrapper, '全部显示（按视点列表的顺序）').trigger(
      'click',
    )

    expect(lastSwitcher(wrapper).items).toEqual(['c1', 'c2', 'c3'])
  })

  it('勾掉最后一个会让清单变空，界面上先把这件事说在前面', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1'] }))

    expect(wrapper.text()).toContain('勾掉最后一个会让清单变空')
  })

  it('勾掉最后一个确实退回空清单', async () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1'] }))

    await checkboxAt(wrapper, 0).setValue(false)

    expect(lastSwitcher(wrapper).items).toEqual([])
  })
})

describe('挑视点', () => {
  it('只能从现有视点里勾，勾中的排在前面', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c2'] }))

    const labels = wrapper.findAll('li').map((item) => item.text())
    expect(labels[0]).toContain('俯视')
    expect(labels).toHaveLength(3)
  })

  it('没名字的视点也认得出来，不显示成一片空白', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c3'] }))

    expect(wrapper.text()).toContain('未命名视点')
  })

  it('勾上一个追加进清单末尾', async () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1'] }))

    await checkboxAt(wrapper, 1).setValue(true)

    expect(lastSwitcher(wrapper).items).toEqual(['c1', 'c2'])
  })

  it('顺序就是运行态的显示序，能挪', async () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1', 'c2'] }))

    await iconButton(wrapper, '下移 全景').trigger('click')

    expect(lastSwitcher(wrapper).items).toEqual(['c2', 'c1'])
  })

  it('第一个不给上移、最后一个不给下移', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1', 'c2'] }))

    expect(
      iconButton(wrapper, '上移 全景').attributes('disabled'),
    ).toBeDefined()
    expect(
      iconButton(wrapper, '下移 俯视').attributes('disabled'),
    ).toBeDefined()
  })

  it('没勾中的行不给挪', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1'] }))

    expect(
      iconButton(wrapper, '上移 俯视').attributes('disabled'),
    ).toBeDefined()
    expect(
      iconButton(wrapper, '下移 俯视').attributes('disabled'),
    ).toBeDefined()
  })

  it('指向已删视点的清单项要报出来，而不是静默少一项', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1', '没了'] }))

    expect(wrapper.text()).toContain('1 个视点已经被删掉了')
  })

  it('一个视点都没有时给去加一个的说法', () => {
    const wrapper = mountSwitcher(makeSwitcher({ items: ['c1'] }), [])

    expect(wrapper.text()).toContain('还没有视点')
  })
})

describe('控件本身', () => {
  it('关掉整个控件时形态与键盘开关一起收起来', () => {
    const wrapper = mountSwitcher(makeSwitcher({ enabled: false }))

    expect(wrapper.text()).not.toContain('按钮排')
    expect(wrapper.text()).not.toContain('数字键与方向键也能切')
  })

  it('形态的选项从常量联合生成', () => {
    const wrapper = mountSwitcher()

    expect(wrapper.text()).toContain('按钮排')
    expect(wrapper.text()).toContain('下拉')
  })

  it('开关整份写回，不就地改 props', async () => {
    const switcher = makeSwitcher({ items: ['c1'] })
    const wrapper = mountSwitcher(switcher)

    await switchByLabel(wrapper, '数字键与方向键也能切').trigger('click')

    const next = lastSwitcher(wrapper)
    expect(next.keyboard).toBe(true)
    expect(next.items).toEqual(['c1'])
    expect(switcher.keyboard).toBe(false)
  })
})
