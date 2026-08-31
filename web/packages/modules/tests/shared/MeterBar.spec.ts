/**
 * @fileoverview 守行内进度件的两档：细条（小字 + 占比读数 + 可选发光圆点 + 轨道）
 * 与粗轨道（四根等距刻度 + 虚线目标标记 + 轨道内 pill）。
 * ⚠ 三条口径错了都不报错：占比为 0 时整条填充仍被画出来（看着像「有一点点」）、
 * 首末刻度居中导致一半溢出被裁、量程不到一万仍走「万」把刻度全塌成「0.0万」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MeterBar from '../../src/shared/MeterBar.vue'
import type { MeterKind, MeterScale, MeterView } from '../../src/shared/meter'

// 量程搬进 `shared/meter.ts` 之后这里直接用真类型——以前那份手抄的副本是因为
// `.vue` 的具名类型导出只有 vue-tsc 解析得出来，typescript-eslint 眼里它是 any
const BASE_SCALE: MeterScale = {
  min: 0,
  max: 100,
  target: null,
  targetLabel: '计划',
  wanFormat: false,
  wanDigits: 2,
  precision: 0,
  pillValue: null,
  pillUnit: '',
}

function meter(over: Partial<MeterView> = {}): MeterView {
  return {
    show: true,
    label: '占比',
    text: '42.5%',
    fill: '42.5%',
    segments: null,
    ...over,
  }
}

function scale(over: Partial<MeterScale> = {}): MeterScale {
  return { ...BASE_SCALE, ...over }
}

interface RenderInput {
  meter?: Partial<MeterView>
  dot?: boolean
  kind?: MeterKind
  scale?: MeterScale | null
}

function render(input: RenderInput = {}) {
  return mount(MeterBar, {
    props: {
      meter: meter(input.meter),
      dot: input.dot ?? false,
      kind: input.kind ?? 'bar',
      scale: input.scale ?? null,
    },
  })
}

function tickLabels(wrapper: ReturnType<typeof render>): string[] {
  return wrapper.findAll('.dt-meter__tick').map((node) => node.text())
}

function tickShifts(wrapper: ReturnType<typeof render>): string[] {
  return wrapper
    .findAll('.dt-meter__tick')
    .map((node) => node.attributes('style') ?? '')
}

describe('细条档', () => {
  it('小字与占比读数各画各的，轨道永远在', () => {
    const wrapper = render()

    expect(wrapper.get('.dt-meter__label').text()).toBe('占比')
    expect(wrapper.get('.dt-meter__pct').text()).toBe('42.5%')
    expect(wrapper.find('.dt-meter__track').exists()).toBe(true)
    expect(wrapper.get('.dt-meter').classes()).toContain('dt-meter--bar')
  })

  it('填充宽度原样来自取值层，不在模板里再算一次', () => {
    const wrapper = render({ meter: { fill: '87.5%' } })

    expect(wrapper.get('.dt-meter__fill').attributes('style')).toContain(
      'width: 87.5%',
    )
  })

  it('占比为 0 时整条填充不渲染——条自己有最小宽度，画出来像「有一点点」', () => {
    const wrapper = render({ meter: { fill: '', text: '0%' } })

    expect(wrapper.find('.dt-meter__fill').exists()).toBe(false)
    expect(wrapper.get('.dt-meter__pct').text()).toBe('0%')
  })

  it('关掉占比读数与小字时那两处整个不占位', () => {
    const wrapper = render({ meter: { label: '', text: '' } })

    expect(wrapper.find('.dt-meter__label').exists()).toBe(false)
    expect(wrapper.find('.dt-meter__pct').exists()).toBe(false)
  })

  it('发光圆点由开关决定', () => {
    expect(render({ dot: true }).find('.dt-meter__dot').exists()).toBe(true)
    expect(render({ dot: false }).find('.dt-meter__dot').exists()).toBe(false)
  })

  it('细条档不画刻度、目标标记与轨道内 pill', () => {
    const wrapper = render({
      scale: scale({ target: 80, pillValue: 8500, pillUnit: 'kWh' }),
    })

    expect(wrapper.findAll('.dt-meter__tick')).toHaveLength(0)
    expect(wrapper.find('.dt-meter__pill').exists()).toBe(false)
  })
})

describe('粗轨道档的刻度', () => {
  it('四根等距，首末落在量程两端', () => {
    const wrapper = render({ kind: 'track', scale: scale({ max: 100 }) })

    expect(tickLabels(wrapper)).toEqual(['0', '33', '67', '100'])
  })

  it('首末两根换对齐基准，居中的一半会溢出卡片被裁掉', () => {
    const shifts = tickShifts(render({ kind: 'track', scale: scale() }))

    expect(shifts[0]).toContain('translateX(0)')
    expect(shifts[1]).toContain('translateX(-50%)')
    expect(shifts[2]).toContain('translateX(-50%)')
    expect(shifts[3]).toContain('translateX(-100%)')
  })

  it('量程上界够一万时刻度走「万」', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ max: 20000, wanFormat: true, wanDigits: 2 }),
    })

    expect(tickLabels(wrapper)).toEqual([
      '0.00万',
      '0.67万',
      '1.33万',
      '2.00万',
    ])
  })

  it('量程上界不到一万时整件回落——小量程走万会让刻度全塌成一个数', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ max: 9999, wanFormat: true, wanDigits: 2 }),
    })

    expect(tickLabels(wrapper)).toEqual(['0', '3,333', '6,666', '9,999'])
  })

  it('刻度与 pill 共用同一份「万」小数位', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({
        max: 20000,
        wanFormat: true,
        wanDigits: 1,
        pillValue: 8500,
      }),
      meter: { text: '' },
    })

    expect(tickLabels(wrapper)[0]).toBe('0.0万')
    expect(wrapper.get('.dt-meter__pill').text()).toBe('0.9万')
  })
})

describe('粗轨道档的目标标记', () => {
  it('按量程比例落位，标签写在上方', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ target: 80, targetLabel: '计划' }),
    })

    expect(wrapper.get('.dt-meter__target').attributes('style')).toContain(
      'left: 80%',
    )
    expect(wrapper.get('.dt-meter__target-label').text()).toBe('计划80')
  })

  it('贴到两端时标签换对齐基准', () => {
    const left = render({ kind: 'track', scale: scale({ target: 1 }) })
    const right = render({ kind: 'track', scale: scale({ target: 99 }) })

    expect(left.get('.dt-meter__target-label').attributes('style')).toContain(
      'translateX(0)',
    )
    expect(right.get('.dt-meter__target-label').attributes('style')).toContain(
      'translateX(-100%)',
    )
  })

  it('没配目标或量程倒挂都不画标记', () => {
    const none = render({ kind: 'track', scale: scale({ target: null }) })
    const flat = render({
      kind: 'track',
      scale: scale({ min: 50, max: 50, target: 50 }),
    })

    expect(none.find('.dt-meter__target').exists()).toBe(false)
    expect(flat.find('.dt-meter__target').exists()).toBe(false)
  })
})

describe('轨道内的 pill', () => {
  it('读数 + 单位 + 占比拼一句', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ pillValue: 8500, pillUnit: 'kWh' }),
      meter: { text: '85.0%' },
    })

    expect(wrapper.get('.dt-meter__pill').text()).toBe('8,500kWh (85.0%)')
  })

  it('占比算不出来时不拼一对空括号', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ pillValue: 8500, pillUnit: 'kWh' }),
      meter: { text: '—' },
    })

    expect(wrapper.get('.dt-meter__pill').text()).toBe('8,500kWh')
  })

  it('没给读数原值就不画 pill', () => {
    const wrapper = render({ kind: 'track', scale: scale({ pillValue: null }) })

    expect(wrapper.find('.dt-meter__pill').exists()).toBe(false)
  })

  it('pill 读数按量程的小数位补齐', () => {
    const wrapper = render({
      kind: 'track',
      scale: scale({ pillValue: 12.345, precision: 2 }),
      meter: { text: '' },
    })

    expect(wrapper.get('.dt-meter__pill').text()).toBe('12.35')
  })
})
