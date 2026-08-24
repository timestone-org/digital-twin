/**
 * @fileoverview 契约：视点面板把「镜头现在停在哪」标出来，并在名字被截断时
 * 仍然读得到全名。
 *
 * ⚠ 这两条都是静默失效：当前项的标记丢了，面板看着照常、只是分不出哪个是当前；
 * 提示里漏了名字，窄面板上被截掉的那半就没有任何地方读得到。
 */
import { normalizeTwinConfig, type TwinCamera } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinViewpointBar from '../src/TwinViewpointBar.vue'

const CAMERAS = [
  { id: 'c1', name: '动力中心标准视点' },
  { id: 'c2', name: '全览视点' },
  { id: 'c3' },
]

function camerasOf(raw: unknown[] = CAMERAS): TwinCamera[] {
  return normalizeTwinConfig({ cameras: raw }).cameras
}

function render(
  activeId = '',
  keyboard = true,
  items: TwinCamera[] = camerasOf(),
) {
  return mount(TwinViewpointBar, {
    props: { items, activeId, mode: 'buttons', keyboard },
  })
}

type Wrapper = ReturnType<typeof render>

function rows(wrapper: Wrapper) {
  return wrapper.findAll('.twin-viewpoints__btn')
}

describe('当前视点', () => {
  it('只有当前那一行带上标记与 aria-pressed', () => {
    const wrapper = render('c2')

    const pressed = rows(wrapper).map((row) => row.attributes('aria-pressed'))
    expect(pressed).toEqual(['false', 'true', 'false'])
    expect(
      rows(wrapper).map((row) =>
        row.classes().includes('twin-viewpoints__btn--now'),
      ),
    ).toEqual([false, true, false])
  })

  // 还没切过时不许有人冒充当前项：下拉档会退到第一个，按钮档不该跟着退
  it('还没切过时一行都不算当前', () => {
    const wrapper = render()

    expect(
      rows(wrapper).some((row) =>
        row.classes().includes('twin-viewpoints__btn--now'),
      ),
    ).toBe(false)
  })
})

describe('序号与名字分开', () => {
  it('序号在自己那一格里，不和名字连成一串', () => {
    const wrapper = render()
    const first = rows(wrapper)[0]

    expect(first?.find('.twin-viewpoints__index').text()).toBe('1')
    expect(first?.find('.twin-viewpoints__name').text()).toBe(
      '动力中心标准视点',
    )
  })

  it('没起名的视点按序号叫，不留一行空白', () => {
    const wrapper = render()

    expect(rows(wrapper)[2]?.find('.twin-viewpoints__name').text()).toBe(
      '视点 3',
    )
  })
})

describe('悬停提示与快捷键', () => {
  it('提示里带全名，截断的那半靠它读得到', () => {
    const wrapper = render()

    expect(rows(wrapper)[0]?.attributes('title')).toBe(
      '动力中心标准视点（数字键 1）',
    )
  })

  it('快捷键关着时提示只剩名字，也不写 aria-keyshortcuts', () => {
    const wrapper = render('', false)
    const first = rows(wrapper)[0]

    expect(first?.attributes('title')).toBe('动力中心标准视点')
    expect(first?.attributes('aria-keyshortcuts')).toBeUndefined()
  })

  it('开着时把数字键报给读屏', () => {
    const wrapper = render()

    expect(
      rows(wrapper).map((row) => row.attributes('aria-keyshortcuts')),
    ).toEqual(['1', '2', '3'])
  })

  // 数字键只到 9：第 10 个往后不许提一个按不出来的键
  it('第 10 个视点起不再提数字键', () => {
    const many = camerasOf(
      Array.from({ length: 10 }, (_, index) => ({ id: `c${index}` })),
    )
    const wrapper = render('', true, many)

    const shortcuts = rows(wrapper).map((row) =>
      row.attributes('aria-keyshortcuts'),
    )
    expect(shortcuts[8]).toBe('9')
    expect(shortcuts[9]).toBeUndefined()
    expect(rows(wrapper)[9]?.attributes('title')).toBe('视点 10')
  })
})

describe('点选', () => {
  it('点一行抛出那个视点的 id', async () => {
    const wrapper = render()

    await rows(wrapper)[1]?.trigger('click')

    expect(wrapper.emitted('pick')).toEqual([['c2']])
  })
})
