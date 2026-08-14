/**
 * @fileoverview 守图表取色的两条铁律：颜色全部来自 CSS 变量、取不到就交回空串
 * （不伪造颜色），以及换肤后必须重绘——canvas 不吃 CSS 级联，不重绘就一直是旧色。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, type Ref } from 'vue'

import {
  SERIES_VARS,
  divergingStops,
  readChartTheme,
  readCssVar,
  resolveColor,
  sequentialStops,
  seriesColor,
  useThemeRedraw,
  withAlpha,
  withColor,
  type ChartTheme,
} from '../../../src/shared/chart/theme'

/** 造一份主题：只给测试关心的那几档，其余留空串（= 取不到）。 */
function theme(patch: Partial<ChartTheme> = {}): ChartTheme {
  return {
    palette: [],
    text: '',
    textMuted: '',
    axisLine: '',
    splitLine: '',
    accent: '',
    idle: '',
    tooltipBg: '',
    tooltipBorder: '',
    ...patch,
  }
}

afterEach(() => {
  document.body.removeAttribute('style')
})

describe('readCssVar', () => {
  it('从元素级联读得到值', () => {
    const host = document.createElement('div')
    host.style.setProperty('--text-primary', 'rgb(1, 2, 3)')
    document.body.appendChild(host)

    expect(readCssVar(host, '--text-primary')).toBe('rgb(1, 2, 3)')

    host.remove()
  })

  it('变量缺席时给空串，让消费方省掉这个键', () => {
    expect(readCssVar(document.createElement('div'), '--nope')).toBe('')
  })
})

describe('readChartTheme', () => {
  it('色板按 SERIES_VARS 的顺序取', () => {
    const host = document.createElement('div')
    SERIES_VARS.forEach((name, index) => {
      host.style.setProperty(name, `c${index}`)
    })
    document.body.appendChild(host)

    expect(readChartTheme(host).palette).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
    ])

    host.remove()
  })

  it('一个变量都没有时全给空串', () => {
    const host = document.createElement('div')

    expect(readChartTheme(host)).toEqual(
      theme({ palette: ['', '', '', '', '', ''] }),
    )
  })
})

describe('seriesColor', () => {
  it('系列数超过色板时循环取用', () => {
    expect(seriesColor(['a', 'b'], 0)).toBe('a')
    expect(seriesColor(['a', 'b'], 3)).toBe('b')
  })

  it('空色板给空串', () => {
    expect(seriesColor([], 0)).toBe('')
  })
})

describe('withColor', () => {
  it('有色才写 color 键', () => {
    expect(withColor('red')).toEqual({ color: 'red' })
  })

  it('空色给空对象——写 color:"" 会画成透明而不是回退默认色', () => {
    expect(withColor('')).toEqual({})
  })
})

describe('resolveColor', () => {
  it('var(--x) 经 lookup 取实际色', () => {
    expect(resolveColor('var(--accent-primary)', () => 'red')).toBe('red')
  })

  it('lookup 取不到时用 var 自带的兜底', () => {
    expect(resolveColor('var(--nope, blue)', () => '')).toBe('blue')
  })

  it('lookup 与兜底都空时给空串', () => {
    expect(resolveColor('var(--nope)', () => '')).toBe('')
  })

  it('普通色串原样返回', () => {
    expect(resolveColor('rgb(1, 2, 3)', () => 'red')).toBe('rgb(1, 2, 3)')
  })

  it('空值给空串', () => {
    expect(resolveColor(null, () => 'red')).toBe('')
  })
})

describe('withAlpha', () => {
  it('#rrggbb 叠透明度', () => {
    expect(withAlpha('#0a141e', 0.5)).toBe('rgba(10, 20, 30, 0.5)')
  })

  it('#rgb 先展开再叠', () => {
    expect(withAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
  })

  it('rgb() 与 rgba() 都认，透明度以新值为准', () => {
    expect(withAlpha('rgb(1, 2, 3)', 0.2)).toBe('rgba(1, 2, 3, 0.2)')
    expect(withAlpha('rgba(1, 2, 3, 0.9)', 0.2)).toBe('rgba(1, 2, 3, 0.2)')
  })

  it('透明度钳到 [0,1]', () => {
    expect(withAlpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)')
    expect(withAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)')
  })

  it('解析不了的写法原样返回，不猜一个色出来', () => {
    expect(withAlpha('hsl(200 50% 50%)', 0.5)).toBe('hsl(200 50% 50%)')
    expect(withAlpha('', 0.5)).toBe('')
  })
})

describe('sequentialStops', () => {
  it('按冷→暖重排色板', () => {
    const stops = sequentialStops(
      theme({ palette: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] }),
    )

    expect(stops).toEqual(['p4', 'p0', 'p1', 'p2', 'p3'])
  })

  it('色板不够时退回主色的深浅渐变', () => {
    expect(sequentialStops(theme({ accent: '#000000' }))).toEqual([
      'rgba(0, 0, 0, 0.15)',
      'rgba(0, 0, 0, 0.55)',
      '#000000',
    ])
  })

  it('连主色都没有时给空数组，交回 echarts 默认色阶', () => {
    expect(sequentialStops(theme())).toEqual([])
  })
})

describe('divergingStops', () => {
  it('取「冷 - 中性 - 暖」三段', () => {
    const stops = divergingStops(
      theme({ palette: ['p0', 'p1', 'p2', 'p3'], idle: 'mid' }),
    )

    expect(stops).toEqual(['p0', 'mid', 'p3'])
  })

  it('没有 idle 时中段退到次要文字色', () => {
    const stops = divergingStops(
      theme({ palette: ['p0', 'p1', 'p2', 'p3'], textMuted: 'muted' }),
    )

    expect(stops).toEqual(['p0', 'muted', 'p3'])
  })

  it('色板不够时退回主色的深浅渐变', () => {
    expect(divergingStops(theme({ accent: '#000000' }))).toEqual([
      'rgba(0, 0, 0, 0.15)',
      'rgba(0, 0, 0, 0.55)',
      '#000000',
    ])
  })
})

/** 把 useThemeRedraw 挂进一个真组件，好走完整的挂载与卸载。 */
function mountRedraw(redraw: () => void) {
  const Host = defineComponent({
    setup() {
      const root: Ref<HTMLElement | null> = ref(null)
      useThemeRedraw(root, redraw)
      return { root }
    },
    template: '<div ref="root" />',
  })
  return mount(Host, { attachTo: document.body })
}

describe('useThemeRedraw', () => {
  it('祖先换肤后重绘', async () => {
    const redraw = vi.fn()
    const wrapper = mountRedraw(redraw)

    document.body.style.setProperty('--accent-primary', 'red')
    await vi.waitFor(() => expect(redraw).toHaveBeenCalled())

    wrapper.unmount()
  })

  it('一帧内的连续变更只重绘一次', async () => {
    const redraw = vi.fn()
    const wrapper = mountRedraw(redraw)

    document.body.style.setProperty('--accent-primary', 'red')
    document.body.style.setProperty('--accent-secondary', 'blue')
    await vi.waitFor(() => expect(redraw).toHaveBeenCalled())

    expect(redraw).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  // 用「另一个还挂着的组件」当完成信号：它重绘了，说明这批变更已经派发完
  it('卸载后不再重绘——留着观察者就是一次泄漏', async () => {
    const gone = vi.fn()
    const alive = vi.fn()
    const unmounted = mountRedraw(gone)
    const kept = mountRedraw(alive)

    unmounted.unmount()
    document.body.style.setProperty('--accent-primary', 'red')
    await vi.waitFor(() => expect(alive).toHaveBeenCalled())

    expect(gone).not.toHaveBeenCalled()
    kept.unmount()
  })
})
