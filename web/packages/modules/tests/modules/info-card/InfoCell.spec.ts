/**
 * @fileoverview 守一格的四段与两种图标画法：段序固定、有内容才出件、四档读数各自的
 * 修饰类，以及「标签行不渲染时连档位类名都不挂」。
 * ⚠ 无标签时挂上 `label-left` 会多出一列空网格与一个列间距，令读数偏移几像素——
 * 没人会把它当 bug 报上来，只能靠这里钉住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import InfoCell from '../../../src/modules/info-card/InfoCell.vue'
import type { CardCell } from '../../../src/modules/info-card/cells'
import {
  readCardLook,
  type CardLook,
} from '../../../src/modules/info-card/look'

function cell(over: Partial<CardCell> = {}): CardCell {
  return {
    key: 'cell-a',
    index: 0,
    label: '今日产热量',
    labelIsHit: false,
    emoji: '',
    icon: '',
    state: 'ok',
    text: '12,386',
    unit: 'kWh',
    reason: '',
    digit: true,
    gradient: false,
    blink: false,
    dot: null,
    compare: null,
    emitValue: '',
    vars: {},
    ...over,
  }
}

function look(config: Record<string, unknown> = {}): CardLook {
  return readCardLook(config)
}

function render(
  over: Partial<CardCell> = {},
  config: Record<string, unknown> = {},
): ReturnType<typeof mount> {
  return mount(InfoCell, { props: { cell: cell(over), look: look(config) } })
}

describe('段序固定的四段', () => {
  it('标签、读数与单位各出一件', () => {
    const wrapper = render()

    expect(wrapper.get('.ic-label').text()).toBe('今日产热量')
    expect(wrapper.get('.ic-value').text()).toBe('12,386')
    expect(wrapper.get('.ic-unit').text()).toBe('kWh')
  })

  it('没有标签时整行不渲染，档位类名也不挂', () => {
    const wrapper = render({ label: '' }, { labelPlace: 'left' })

    expect(wrapper.find('.ic-label').exists()).toBe(false)
    expect(wrapper.get('.ic-cell').classes()).not.toContain(
      'ic-cell--label-left',
    )
  })

  it('有标签时才挂档位类名，三档各一个', () => {
    for (const place of ['above', 'below', 'left']) {
      const wrapper = render({}, { labelPlace: place })

      expect(wrapper.get('.ic-cell').classes()).toContain(
        `ic-cell--label-${place}`,
      )
    }
  })

  it('命中文案顶掉标签时换一个类，颜色跟着数值色走', () => {
    const wrapper = render({ label: '超限', labelIsHit: true })

    expect(wrapper.get('.ic-label').classes()).toContain('ic-label--hit')
    expect(render().get('.ic-label').classes()).not.toContain('ic-label--hit')
  })

  it('单位为空时整件不出——一个空的 i 会白占一道间隙', () => {
    expect(render({ unit: '' }).find('.ic-unit').exists()).toBe(false)
  })

  it('涨跌块三件按有没有内容各自出', () => {
    const wrapper = render({
      compare: { dir: 'up', arrow: '▲', text: '20%', label: '较上期' },
    })

    expect(wrapper.get('.ic-compare__arrow').text()).toBe('▲')
    expect(wrapper.get('.ic-compare__delta').text()).toBe('20%')
    expect(wrapper.get('.ic-compare__label').text()).toBe('较上期')
  })

  it('没有注脚就不画注脚，没有涨跌块就整块不画', () => {
    const bare = render({
      compare: { dir: 'flat', arrow: '—', text: '0', label: '' },
    })

    expect(bare.find('.ic-compare__label').exists()).toBe(false)
    expect(render().find('.ic-compare').exists()).toBe(false)
  })

  it('状态点自己没有文字，靠严重度那个词给读屏与悬停提示', () => {
    const wrapper = render({ dot: { level: 'danger', text: '危急' } })
    const dot = wrapper.get('.ic-dot')

    expect(dot.attributes('aria-label')).toBe('危急')
    expect(dot.attributes('title')).toBe('危急')
    expect(render().find('.ic-dot').exists()).toBe(false)
  })
})

describe('读数四档', () => {
  it('三档没有读数的各挂一个类——屏上全靠它们给的颜色与透明度分开', () => {
    const classOf = (state: CardCell['state']): string[] =>
      render({ state, text: '—', unit: '' }).get('.ic-value').classes()

    expect(classOf('pending')).toContain('ic-value--pending')
    expect(classOf('unbound')).toContain('ic-value--unbound')
    expect(classOf('error')).toContain('ic-value--error')
  })

  it('有值那一档不挂任何档位类', () => {
    const classes = render().get('.ic-value').classes()

    expect(classes).toEqual(['ic-value'])
  })

  it('没有值的那一句话挂 title，有值时不挂', () => {
    const absent = render({ state: 'error', reason: '取不到：点位不存在' })

    expect(absent.get('.ic-value').attributes('title')).toBe(
      '取不到：点位不存在',
    )
    expect(render().get('.ic-value').attributes('title')).toBeUndefined()
  })

  it('渐变、回退正文字体与闪烁三个类各自独立', () => {
    const wrapper = render({ gradient: true, digit: false, blink: true })
    const classes = wrapper.get('.ic-value').classes()

    expect(classes).toContain('ic-value--gradient')
    expect(classes).toContain('ic-value--plain')
    expect(classes).toContain('ic-value--blink')
  })
})

describe('两种图标画法', () => {
  it('右上角标画素材图', () => {
    const wrapper = render({ icon: '/i.png' }, { icon: { mode: 'corner' } })

    expect(wrapper.get('img.ic-corner').attributes('src')).toBe('/i.png')
  })

  it('取不到素材图时角标退回 emoji', () => {
    const wrapper = render({ emoji: '🌡️' }, { icon: { mode: 'corner' } })

    expect(wrapper.get('.ic-corner--emoji').text()).toBe('🌡️')
  })

  it('两者都空时角标整件不画，不留一个碎图', () => {
    const wrapper = render({}, { icon: { mode: 'corner' } })

    expect(wrapper.find('.ic-corner').exists()).toBe(false)
  })

  it('图标容器里素材图优先，其次 emoji', () => {
    const image = render(
      { icon: '/i.png', emoji: '🌡️' },
      { icon: { mode: 'badge' } },
    )
    const emoji = render({ emoji: '🌡️' }, { icon: { mode: 'badge' } })

    expect(image.get('.ic-badge__img').attributes('src')).toBe('/i.png')
    expect(emoji.get('.ic-badge').text()).toBe('🌡️')
    expect(emoji.find('.ic-badge__img').exists()).toBe(false)
  })

  it('两者都空时整个容器不画——留下来就是一个空圈', () => {
    expect(
      render({}, { icon: { mode: 'badge' } })
        .find('.ic-badge')
        .exists(),
    ).toBe(false)
  })

  it('不画那一档两种画法都不出，即使这一格有图', () => {
    const wrapper = render(
      { icon: '/i.png', emoji: '🌡️' },
      { icon: { mode: 'none' } },
    )

    expect(wrapper.find('.ic-corner').exists()).toBe(false)
    expect(wrapper.find('.ic-badge').exists()).toBe(false)
  })
})

describe('档位类与变量', () => {
  it('块级档位类一份挂在格上，样式表因此不必写后代选择器', () => {
    const classes = render({}, { cellShell: 'accent', hover: 'lift' })
      .get('.ic-cell')
      .classes()

    expect(classes).toContain('ic--shell-accent')
    expect(classes).toContain('ic--hover-lift')
  })

  it('块级变量与逐格变量一起摊在格上：一格能脱开容器单独挂载', () => {
    const wrapper = render(
      { vars: { '--ic-cell-color': 'var(--state-danger)' } },
      { valueGlow: 12 },
    )
    const style = wrapper.get('.ic-cell').attributes('style') ?? ''

    expect(style).toContain('--ic-value-glow: 12px')
    expect(style).toContain('--ic-cell-color: var(--state-danger)')
  })

  it('配了联动值的格才是手型', () => {
    expect(render({ emitValue: 'a' }).get('.ic-cell').classes()).toContain(
      'ic-cell--pick',
    )
    expect(render().get('.ic-cell').classes()).not.toContain('ic-cell--pick')
  })
})

describe('点一格', () => {
  it('配了联动值的格吞冒泡，没配的放它上去让整块兜底', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)

    const picked = mount(InfoCell, {
      attachTo: document.body,
      props: { cell: cell({ emitValue: 'unit-a' }), look: look() },
    })
    await picked.get('.ic-cell').trigger('click')
    expect(spy).not.toHaveBeenCalled()
    expect(picked.emitted('pick')).toEqual([['unit-a']])
    picked.unmount()

    const plain = mount(InfoCell, {
      attachTo: document.body,
      props: { cell: cell({ emitValue: '' }), look: look() },
    })
    await plain.get('.ic-cell').trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(plain.emitted('pick')).toBeUndefined()
    plain.unmount()

    document.body.removeEventListener('click', spy)
  })
})
