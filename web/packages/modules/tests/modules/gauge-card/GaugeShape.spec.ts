/**
 * @fileoverview 守五档几何各自画出来的那几件：弧的两条 path 与按百分比截断的 dashoffset、
 * 条与轨道的填充宽度、储罐与温度计的液面高度，以及刻度、目标标记与轨道内 pill 只有粗轨道
 * 那一档摆。
 * ⚠ 真实 0% 必须整条填充不渲染：只把宽/高设成 0 会留一小截带辉光的圆角色块。
 * ⚠ 渐变描边只能走 SVG 的 `<linearGradient>`，且 id 必须逐个实例唯一——共用一个 id 时
 * 后面每一个仪表都引到第一个的色标，换了填充色也不跟着变，而控制台一声不吭。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import GaugeShape from '../../../src/modules/gauge-card/GaugeShape.vue'
import {
  buildGaugeViews,
  gaugeFieldKey,
  GAUGE_ITEMS_KEY,
  type GaugeView,
} from '../../../src/modules/gauge-card/gauges'
import {
  readGaugeLook,
  type GaugeLook,
} from '../../../src/modules/gauge-card/look'
import { GAUGE_SHAPE_VALUES } from '../../../src/modules/gauge-card/options'

/** 一个仪表的取值：量程 0–100、单位 kW，读数与行内覆盖由调用方给。 */
function viewOf(
  config: Record<string, unknown> = {},
  value: unknown = 42,
  itemOver: Record<string, unknown> = {},
): GaugeView {
  const views = buildGaugeViews({
    config: {
      ...config,
      [GAUGE_ITEMS_KEY]: [
        { label: '给水流量', unit: 'kW', min: 0, max: 100, ...itemOver },
      ],
    },
    rows: [{ value }],
    slots: { [gaugeFieldKey(0, 'value')]: { state: 'ok' } },
  })
  const view = views[0]
  if (view === undefined) throw new Error('这一块一个仪表都没摊出来')
  return view
}

function lookOf(config: Record<string, unknown> = {}): GaugeLook {
  return readGaugeLook(config)
}

function render(
  config: Record<string, unknown> = {},
  value: unknown = 42,
): ReturnType<typeof mount> {
  return mount(GaugeShape, {
    props: { view: viewOf(config, value), look: lookOf(config) },
  })
}

describe('五档几何各摆各的', () => {
  it.each(GAUGE_SHAPE_VALUES)('%s 档挂上自己的形状类且画得出东西', (shape) => {
    const wrapper = render({ shape })

    expect(wrapper.get('.gc-shape').classes()).toContain(`gc-shape--${shape}`)
    expect(wrapper.get('.gc-figure').element.children.length).toBeGreaterThan(0)
  })

  it('弧度盘画两条 path：底下那条恒在，填充那条按百分比截断', () => {
    const wrapper = render({ shape: 'arc' })

    expect(wrapper.get('.gc-arc__track').attributes('stroke-width')).toBe('9')
    expect(wrapper.get('.gc-arc__fill').attributes('stroke-dashoffset')).toBe(
      '58',
    )
    expect(wrapper.get('.gc-arc__fill').attributes('pathLength')).toBe('100')
  })

  it('横向条与粗轨道共用一条轨道，填充宽度就是那个百分比', () => {
    expect(
      render({ shape: 'linear' }).get('.gc-bar__fill').attributes('style'),
    ).toContain('width: 42%')
    expect(
      render({ shape: 'track' }).get('.gc-bar__fill').attributes('style'),
    ).toContain('width: 42%')
  })

  it('储罐画液面与液面高光，温度计画管与球', () => {
    const tank = render({ shape: 'tank' })
    const thermo = render({ shape: 'thermometer' })

    expect(tank.get('.gc-tank__fill').attributes('style')).toContain(
      'height: 42%',
    )
    expect(tank.find('.gc-tank__surface').exists()).toBe(true)
    expect(thermo.get('.gc-thermo__fill').attributes('style')).toContain(
      'height: 42%',
    )
    expect(thermo.find('.gc-thermo__bulb').exists()).toBe(true)
  })
})

describe('真实 0% 整条填充不渲染', () => {
  it.each(GAUGE_SHAPE_VALUES)('%s 档没有读数时一件填充都不出', (shape) => {
    // ⚠ 这里传 null 而不是 undefined：默认形参遇到 undefined 会顶上 42，
    //   于是「没有读数」那一支根本没跑到，用例照样绿
    const wrapper = render({ shape }, null)

    expect(wrapper.find('.gc-arc__fill').exists()).toBe(false)
    expect(wrapper.find('.gc-bar__fill').exists()).toBe(false)
    expect(wrapper.find('.gc-tank__fill').exists()).toBe(false)
    expect(wrapper.find('.gc-thermo__fill').exists()).toBe(false)
  })

  it('读数正好是 0 也不留那一小截带辉光的色块', () => {
    expect(render({ shape: 'tank' }, 0).find('.gc-tank__fill').exists()).toBe(
      false,
    )
  })

  it('表盘本身照画——底下的轨道、管与球不跟着消失', () => {
    expect(render({ shape: 'arc' }, null).find('.gc-arc__track').exists()).toBe(
      true,
    )
    expect(render({ shape: 'linear' }, null).find('.gc-bar').exists()).toBe(
      true,
    )
    expect(
      render({ shape: 'thermometer' }, null).find('.gc-thermo__bulb').exists(),
    ).toBe(true)
  })
})

describe('刻度、目标标记与 pill 只有粗轨道那一档摆', () => {
  const scale = { ticks: true, tickCount: 4 }

  it('粗轨道把刻度与 pill 都摆出来', () => {
    const wrapper = render({ shape: 'track', scale })

    expect(wrapper.findAll('.gc-tick')).toHaveLength(4)
    expect(wrapper.get('.gc-pill').text()).toBe('42kW (42.0%)')
  })

  it('横向条一件都不摆——那三件是粗轨道那一档的参数', () => {
    const wrapper = render({ shape: 'linear', scale, targetMark: true })

    expect(wrapper.find('.gc-ticks').exists()).toBe(false)
    expect(wrapper.find('.gc-pill').exists()).toBe(false)
    expect(wrapper.find('.gc-target').exists()).toBe(false)
  })

  it('首末刻度换对齐基准，居中的那一半不会溢出卡片被裁掉', () => {
    const ticks = render({ shape: 'track', scale }).findAll('.gc-tick')

    expect(ticks[0]?.attributes('style')).toContain('translateX(0)')
    expect(ticks[3]?.attributes('style')).toContain('translateX(-100%)')
    expect(ticks[1]?.attributes('style')).toContain('translateX(-50%)')
  })

  it('目标标记是一条虚线加上方一个标签，落点走量程归一', () => {
    const wrapper = mount(GaugeShape, {
      props: {
        view: viewOf({ targetMark: true }, 42, { target: 80 }),
        look: lookOf({ shape: 'track' }),
      },
    })

    expect(wrapper.get('.gc-target').attributes('style')).toContain('left: 80%')
    expect(wrapper.get('.gc-target__label').text()).toBe('计划80')
  })
})

describe('渐变填充', () => {
  it('纯色档不出 defs，弧的描边留给样式表', () => {
    const wrapper = render({ shape: 'arc', fillStyle: 'solid' })

    expect(wrapper.find('linearGradient').exists()).toBe(false)
    expect(wrapper.get('.gc-arc__fill').attributes('style')).toBeUndefined()
  })

  it('渐变档给弧一份自己的色标，描边走内联样式而不是表示属性', () => {
    const wrapper = render({ shape: 'arc', fillStyle: 'gradient' })
    const id = wrapper.get('linearGradient').attributes('id')

    expect(wrapper.get('.gc-shape').classes()).toContain('gc-shape--grad')
    expect(wrapper.get('.gc-arc__fill').attributes('style')).toContain(
      `url(#${String(id)})`,
    )
  })

  it('同一屏上的两个仪表拿到不同的色标 id', () => {
    // ⚠ 必须在**同一个 app 里**挂两份：`useId` 的计数器按 app 走，各 mount 一次
    //   两边都会拿到第一个号，断言当场变成永远绿的
    const config = { shape: 'arc', fillStyle: 'gradient' }
    const props = { view: viewOf(config), look: lookOf(config) }
    const pair = mount(
      defineComponent({
        setup() {
          return () => h('div', [h(GaugeShape, props), h(GaugeShape, props)])
        },
      }),
    )
    const ids = pair
      .findAll('linearGradient')
      .map((node) => node.attributes('id'))

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('条与罐的渐变走类名，不额外注入变量', () => {
    expect(
      render({ shape: 'tank', fillStyle: 'gradient' })
        .get('.gc-shape')
        .classes(),
    ).toContain('gc-shape--grad')
  })
})

describe('量程端点与居中读数', () => {
  it('开了量程端点就在图形之外摆两个字，不参与居中', () => {
    const wrapper = render({ shape: 'arc', scale: { showRange: true } })

    expect(wrapper.get('.gc-range__min').text()).toBe('0')
    expect(wrapper.get('.gc-range__max').text()).toBe('100')
  })

  it('关着的时候整件不出', () => {
    expect(render({ shape: 'arc' }).find('.gc-range').exists()).toBe(false)
  })

  it('居中层只有真给了插槽内容才画，空着一层会白挡住整个图形', () => {
    const withSlot = mount(GaugeShape, {
      props: { view: viewOf(), look: lookOf({ shape: 'arc' }) },
      slots: { center: '<b class="probe">42</b>' },
    })

    expect(render({ shape: 'arc' }).find('.gc-center').exists()).toBe(false)
    expect(withSlot.get('.gc-center .probe').text()).toBe('42')
  })
})

describe('满弧 + 指针', () => {
  const NEEDLE = { shape: 'arc', indicator: 'needle' }

  // ⚠ 整条弧不按读数裁：裁了的话彩虹弧只剩一半，颜色说的就成了「填到哪」
  it('整条弧上色，不带 dashoffset', () => {
    const wrapper = render(NEEDLE)
    const fill = wrapper.get('.gc-arc__fill')

    expect(fill.classes()).toContain('gc-arc__fill--full')
    expect(fill.attributes('stroke-dashoffset')).toBeUndefined()
  })

  it('画出指针与圆心轴', () => {
    const wrapper = render(NEEDLE)

    expect(wrapper.find('.gc-needle__blade').exists()).toBe(true)
    expect(wrapper.find('.gc-needle__hub').exists()).toBe(true)
  })

  // ⚠ 指在起点会被读成「现在是最小值」
  // ⚠ 这里传 `null` 不传 `undefined`：`render` 的形参有默认值 42，显式传
  //   `undefined` 会触发默认值，用例就变成在测「有读数」那一路
  it('读数取不到时一根指针都不画', () => {
    const wrapper = render(NEEDLE, null)

    expect(wrapper.find('.gc-needle').exists()).toBe(false)
  })

  it('读数变了指针跟着转——两个读数的路径不一样', () => {
    const low = render(NEEDLE, 10).get('.gc-needle__blade').attributes('d')
    const high = render(NEEDLE, 90).get('.gc-needle__blade').attributes('d')

    expect(low).not.toBe(high)
  })

  it('缺省仍是填充档：不配 indicator 时画的是按读数截断的那条', () => {
    const wrapper = render({ shape: 'arc' })

    expect(wrapper.get('.gc-arc__fill').classes()).not.toContain(
      'gc-arc__fill--full',
    )
    expect(wrapper.find('.gc-needle__blade').exists()).toBe(false)
  })

  // ⚠ 只有弧度盘有圆心可以摆指针：其余四档配了也不该画
  it('别的几何档配了指针也不画', () => {
    const wrapper = render({ shape: 'linear', indicator: 'needle' })

    expect(wrapper.find('.gc-needle__blade').exists()).toBe(false)
  })
})

describe('自定义色标', () => {
  const STOPS = {
    shape: 'arc',
    fillStyle: 'stops',
    colorStops: [
      { at: 0, color: 'var(--state-danger)' },
      { at: 100, color: 'var(--accent-secondary)' },
    ],
  }

  it('配几档就摆几个 stop，颜色逐个落到 stop-color 上', () => {
    const stops = render(STOPS).findAll('stop')

    expect(stops).toHaveLength(2)
    expect(stops[0]?.attributes('stop-color')).toBe('var(--state-danger)')
    expect(stops[0]?.attributes('offset')).toBe('0%')
    expect(stops[1]?.attributes('offset')).toBe('100%')
  })

  // ⚠ `<stop>` 按文档序生效：位置写倒了的两档会被浏览器静默夹平成一段纯色
  it('位置写倒了也按位置排好', () => {
    const stops = render({
      ...STOPS,
      colorStops: [
        { at: 90, color: 'var(--accent-secondary)' },
        { at: 10, color: 'var(--state-danger)' },
      ],
    }).findAll('stop')

    expect(stops.map((one) => one.attributes('offset'))).toEqual(['10%', '90%'])
  })

  // ⚠ 一档渐变没有意义，而只有一个 stop 的 linearGradient 画出来是透明
  it('不足两档时退回样式表里那两个缺省 stop', () => {
    const stops = render({
      ...STOPS,
      colorStops: [{ at: 0, color: 'var(--state-danger)' }],
    }).findAll('stop')

    expect(stops.map((one) => one.attributes('stop-color'))).toEqual([
      undefined,
      undefined,
    ])
  })

  it('纯色档一个 stop 都不摆', () => {
    expect(
      render({ shape: 'arc', fillStyle: 'solid' }).findAll('stop'),
    ).toEqual([])
  })
})
