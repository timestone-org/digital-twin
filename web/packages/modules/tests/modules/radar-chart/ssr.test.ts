/**
 * @fileoverview 把 `buildRadarOption` 出的那份 option 交给**真的 echarts** 跑一遍
 * SSR（`renderer: 'svg'` + `ssr: true` + `renderToSVGString()`），断言画出来的 SVG 里
 * 真有那几行字、那几个形状。
 *
 * ⚠ 这一条抓的是别处抓不到的一类缺陷：组件用例把 echarts 整包打了桩，断言的是
 * option 对象的形状，而错的是「这份合法的 option 交给真 echarts 之后画不出来」。
 * 图例只认「名字等于某条 series 的 `name`」这一条认领路径，认领不到的那一条
 * `_createItem` 根本不会被调用——图例项**不存在**，dev 下只刷一句 warn，
 * 生产构建下连这个都没有。
 * ⚠ 这里自己 `use()` 一套 SVG 渲染器：`shared/chart/echarts.ts` 只注册了
 * CanvasRenderer（canvas 在 happy-dom 里画不出可断言的东西）。注册是全局一次性的，
 * 多注册一个渲染器不影响那份清单，也不用改它。
 */
import { describe, expect, it } from 'vitest'

import type { ModuleSlotMeta } from '@dt/contracts'

import {
  AXIS_ITEMS_KEY,
  AXIS_NOTES,
  axisFieldKey,
  buildAxisViews,
  COMPARE_NOTES,
  type AxisView,
} from '../../../src/modules/radar-chart/axes'
import { buildRadarOption } from '../../../src/modules/radar-chart/option'
import type { ECOption } from '../../../src/shared/chart/echarts'
import type { ChartTheme } from '../../../src/shared/chart/theme'

const WIDTH = 520
const HEIGHT = 420

/** SSR 只要能出字与路径就够，颜色用主题里那几个可辨认的记号串。 */
const THEME: ChartTheme = {
  palette: ['#3b82f6', '#f59e0b', '#10b981'],
  text: '#111827',
  textMuted: '#6b7280',
  axisLine: '#d1d5db',
  splitLine: '#e5e7eb',
  accent: '#3b82f6',
  idle: '#9ca3af',
  tooltipBg: '#ffffff',
  tooltipBorder: '#d1d5db',
}

function resolve(): string {
  return ''
}

/** 拿真 echarts 把一份 option 画成 SVG 字符串。 */
async function renderToSvg(option: ECOption): Promise<string> {
  const core = await import('echarts/core')
  const charts = await import('echarts/charts')
  const components = await import('echarts/components')
  const renderers = await import('echarts/renderers')
  core.use([
    charts.RadarChart,
    components.RadarComponent,
    components.LegendComponent,
    components.TooltipComponent,
    renderers.SVGRenderer,
  ])
  const chart = core.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: WIDTH,
    height: HEIGHT,
  })
  chart.setOption(option)
  return chart.renderToSVGString()
}

type State = 'ok' | 'pending' | 'error'

const FIVE = [
  { name: '能效', min: 0, max: 100, unit: '分' },
  { name: '达标率', min: 0, max: 100, unit: '分' },
  { name: '健康度', min: 0, max: 100, unit: '分' },
  { name: '清洁度', min: 0, max: 100, unit: '分' },
  { name: '稳定性', min: 0, max: 100, unit: '分' },
]

function viewsOf(
  config: Record<string, unknown>,
  own: readonly unknown[],
  opts: {
    compare?: readonly unknown[]
    states?: readonly State[]
    compareStates?: readonly State[]
  } = {},
): AxisView[] {
  const slots: Record<string, ModuleSlotMeta> = {}
  own.forEach((_, index) => {
    slots[axisFieldKey(index, 'value')] = {
      state: opts.states?.[index] ?? 'ok',
    }
  })
  opts.compare?.forEach((_, index) => {
    slots[axisFieldKey(index, 'compare')] = {
      state: opts.compareStates?.[index] ?? 'ok',
    }
  })
  return buildAxisViews({
    config,
    rows: own.map((value, index) => ({
      value,
      compare: opts.compare?.[index],
    })),
    slots,
  })
}

/**
 * SVG 里那几条封闭形状的顶点串。
 * ⚠ 认的是 `<polyline>` 上 echarts 自己打的 `ecmeta_ssr_type="chart"`：网格、轴线与
 * 图元符号都是 `<path>`，按 `d` 去筛会把网格一起筛进来（轴数一变筛法就失准）。
 */
function shapes(svg: string): string[] {
  return (svg.match(/<polyline[^>]*ecmeta_ssr_type="chart"[^>]*>/g) ?? []).map(
    (tag) => /points="([^"]*)"/.exec(tag)?.[1] ?? '',
  )
}

async function svgOf(
  config: Record<string, unknown>,
  views: readonly AxisView[],
): Promise<string> {
  return renderToSvg(buildRadarOption(config, views, THEME, resolve))
}

const BASE = { [AXIS_ITEMS_KEY]: FIVE, showLegend: true, precision: 0 }

describe('真 echarts 画得出来', () => {
  it('五根轴全好时轴名、两组的图例名与两个形状都在 SVG 里', async () => {
    const views = viewsOf(BASE, [82, 91, 64, 78, 86], {
      compare: [70, 88, 76, 61, 80],
    })
    const svg = await svgOf(BASE, views)

    for (const name of ['能效', '达标率', '健康度', '清洁度', '稳定性']) {
      expect(svg).toContain(name)
    }
    expect(svg).toContain('本组')
    expect(svg).toContain('对比组')
    // 两组各画一条封闭形状
    expect(shapes(svg).length).toBe(2)
  })

  it('画不出来的那几根轴的名字与原因真的出现在图例里', async () => {
    const views = viewsOf(BASE, [82, 91, 64, 78, 86], {
      states: ['ok', 'error', 'pending', 'ok', 'ok'],
    })
    const svg = await svgOf(BASE, views)

    // 这几行字只能靠「一条同名的空 series」被图例认领；认领不到就一个字都没有
    expect(svg).toContain(`达标率（${AXIS_NOTES.error}）`)
    expect(svg).toContain(`健康度（${AXIS_NOTES.pending}）`)
    expect(svg).toContain('本组')
  })

  it('对比组画不全时那条带原因的图例名也真的画得出来', async () => {
    const views = viewsOf(BASE, [82, 91, 64, 78, 86], {
      compare: [70, 88, 76, 61, 80],
      compareStates: ['error', 'ok', 'ok', 'ok', 'ok'],
    })
    const svg = await svgOf(BASE, views)

    expect(svg).toContain(`对比组（${COMPARE_NOTES.error}）`)
    // 只有本组那一条形状；对比组是一条没有数据的空 series
    expect(shapes(svg).length).toBe(1)
  })

  it('被剔掉的那根轴不在轮子上：它的名字只出现在图例里，不出现在轴位上', async () => {
    const good = await svgOf(BASE, viewsOf(BASE, [82, 91, 64, 78, 86]))
    const broken = await svgOf(
      BASE,
      viewsOf(BASE, [82, 91, 64, 78, 86], {
        states: ['ok', 'error', 'ok', 'ok', 'ok'],
      }),
    )

    // ⚠ 数的是**光秃秃的那个轴名**（`>达标率<`）：带后缀的那条在图例上，
    //   按 `>达标率` 去数会把图例那条一起数进来，两种情形都得 1、断言当场失去意义
    const onWheel = (raw: string): number =>
      (raw.match(/>达标率</g) ?? []).length

    expect(onWheel(good)).toBe(1)
    expect(onWheel(broken)).toBe(0)
    expect(broken).toContain(`达标率（${AXIS_NOTES.error}）`)
  })

  it('剔掉一根轴的形状与「把那一维喂成 0」画出来的形状不是同一个', async () => {
    const dropped = await svgOf(
      BASE,
      viewsOf(BASE, [82, 91, 64, 78, 86], {
        states: ['ok', 'ok', 'error', 'ok', 'ok'],
      }),
    )
    const zeroed = await svgOf(BASE, viewsOf(BASE, [82, 91, 0, 78, 86]))

    // ⚠ 这一条钉的正是「留空 ≠ 夹成 0」：喂 0 会在轮子上留下一个真实的凹陷
    expect(shapes(dropped)[0]).not.toBe(shapes(zeroed)[0])
  })

  it('画得出来的轴不足三根时一张图都不画，空态文案因此不会压在一条线段上', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100 },
        { name: '达标率', min: 0, max: 100 },
      ],
      showLegend: true,
    }
    const svg = await svgOf(config, viewsOf(config, [82, 91]))

    expect(shapes(svg)).toEqual([])
    expect(svg).not.toContain('能效')
  })

  it('开了顶点标签时逐轴读数真的画在图元旁边', async () => {
    const config = { ...BASE, showValueLabel: true }
    const svg = await svgOf(config, viewsOf(config, [82, 91, 64, 78, 86]))

    // ⚠ 标签只挂在图元上：symbol 关掉这几个数会整片静默消失
    for (const text of ['82分', '91分', '64分', '78分', '86分']) {
      expect(svg).toContain(text)
    }
  })

  it('超出量程的读数被夹在最外圈之内，不会画到轴名上去', async () => {
    const inside = await svgOf(BASE, viewsOf(BASE, [100, 91, 64, 78, 86]))
    const over = await svgOf(BASE, viewsOf(BASE, [400, 91, 64, 78, 86]))

    expect(shapes(over)[0]).toBe(shapes(inside)[0])
  })

  it('两组共用一套逐轴量程：同一个数在两组里落在同一个半径上', async () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: 'A', min: 0, max: 100 },
        { name: 'B', min: 0, max: 1000 },
        { name: 'C', min: 0, max: 10 },
      ],
      showLegend: true,
    }
    const svg = await svgOf(
      config,
      viewsOf(config, [50, 500, 5], { compare: [50, 500, 5] }),
    )
    const drawn = shapes(svg)

    expect(drawn.length).toBe(2)
    expect(drawn[0]).toBe(drawn[1])
  })
})
