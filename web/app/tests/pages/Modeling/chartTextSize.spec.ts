/**
 * @fileoverview 图上的刻度字在屏幕上到底有多大：`viewBox` 把它按「渲染宽 ÷ 画幅
 * 宽」等比缩，故屏上字号由样式里的 `font-size` 与摆图那一格的宽度**两个**数决定，
 * 单看哪一个都判不出来。
 *
 * ⚠ 这件事挂载测试量不出来（happy-dom 不排版），而它坏起来是无声的：图照画、
 * 代码一行不红，只是刻度字缩到读不出数。故这里拿真几何算出的画幅宽、真样式里的
 * 字号、真栅格里的列宽下限三样对起来，算出屏上字号再判。
 * ⚠ 弹窗越宽反而越糟是 `auto-fit` 的固有脾气：多出来的宽度它拿去再排一列，列宽
 * 下限写小了就一路把图挤小。实测 1084px 的辅图格里排三列、每张图只剩 353px，
 * 刻度字 6.87px——比图注那行 10px 的字还小。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import LoadingsGrid from '@/pages/Modeling/Canvas/components/LoadingsGrid.vue'
import { histogramGeometry } from '@/pages/Modeling/Canvas/scripts/histogramGeometry'
import { scatterGeometry } from '@/pages/Modeling/Canvas/scripts/scatterGeometry'
import { loadingsView } from '@/pages/Modeling/Canvas/scripts/structureParts'
import { timelineGeometry } from '@/pages/Modeling/Canvas/scripts/timelineGeometry'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const DIR = join(
  process.cwd(),
  'app',
  'src',
  'pages',
  'Modeling',
  'Canvas',
  'components',
)

/** 屏上刻度字的下限，px。低于它的图上读不出数，等于没画。 */
const MIN_SCREEN_PX = 13
/** 根字号，rem 换算成 px 用。 */
const ROOT_PX = 16
/** 图的那一档宽度：44rem，主体图与辅图共用同一档（规格 §3.2）。 */
const CHART_REM = 44
const CHART_PX = CHART_REM * ROOT_PX

/**
 * 四处摆图的栅格：列宽下限低于一张图那一档时，图会被挤到读不出数。
 * ⚠ 四处写的是同一个数——各写各的迟早漂，故这一条逐处比对同一个字面量。
 */
const LANES: readonly { file: string; at: string; what: string }[] = [
  { file: 'ReportBlocks', at: "&__lane[data-lane='aux']", what: '辅图格' },
  { file: 'BinsBlock', at: '&__grid', what: '逐列分布' },
  { file: 'StructureBlock', at: '&__panels', what: '模型结构' },
  { file: 'RegressionMetricsView', at: '&__aux', what: '回归辅图' },
]

/** 铺图的密度基准：一格 44rem 里摆得下这么多个用户单位。 */
const DENSITY_UNITS = 360

const TRACKS = `repeat(auto-fit, minmax(min(${CHART_REM}rem, 100%), ${CHART_REM}rem))`

const COMMENTS = [/\/\*[\s\S]*?\*\//g, /(^|[^:])\/\/[^\n]*/g]

/** 剥掉注释再扫：注释里写着这些取值的来历，那是在讲它不是在设它。 */
function styleOf(name: string): string {
  const source = readFileSync(join(DIR, `${name}.vue`), 'utf8')
  const block = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(source)
  expect(block?.[1], `${name} 得有 scoped SCSS 块`).toBeTruthy()
  return COMMENTS.reduce(
    (out, pattern) =>
      out.replace(pattern, (_hit: string, head: unknown) =>
        typeof head === 'string' ? head : ' ',
      ),
    block?.[1] ?? '',
  )
}

/** 某个选择器往后第一条声明的取值；查不到给空串。 */
function declarationOf(style: string, at: string, key: string): string {
  const seat = style.indexOf(at)
  if (seat < 0) return ''
  const found = new RegExp(`(?<![-\\w])${key}\\s*:\\s*([^;]+)`).exec(
    style.slice(seat),
  )
  return found?.[1]?.trim() ?? ''
}

/** SVG 里刻度字那一档的字号，px。 */
function textSizeOf(name: string): number {
  const found = /\btext\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(styleOf(name))
  expect(found?.[1], `${name} 的 text 得有 px 字号`).toBeTruthy()
  return Number(found?.[1] ?? 0)
}

/** 画幅横向有多少个用户单位。 */
function unitsOf(viewBox: string): number {
  return Number(viewBox.split(' ')[2])
}

/**
 * 屏上字号 = 字号 × 渲染宽 ÷ 画幅宽。
 *
 * Args: size（用户单位里的字号）、units（画幅宽）、width（渲染宽，px）。
 */
function screenSizeOf(size: number, units: number, width: number): number {
  return (size * width) / units
}

const SERIES = [{ name: '一路', points: [[0, 0] as const, [3, 4] as const] }]
const BINS = [
  { low: 0, high: 1, count: 3 },
  { low: 1, high: 2, count: 7 },
]
const ROWS = [
  {
    name: '实际覆盖',
    segments: [
      { since: 0, until: 10, label: '有数', tone: 'primary' as const },
    ],
  },
]

/** 三个画幅宽固定的图元件：几何由真函数算，不抄常量。 */
const FIXED: readonly { name: string; units: number }[] = [
  {
    name: 'ScatterPlot',
    units: unitsOf(
      scatterGeometry({
        mode: 'pairs',
        series: SERIES,
        rules: [],
        band: null,
        diagonal: false,
      }).viewBox,
    ),
  },
  {
    name: 'HistogramChart',
    units: unitsOf(
      histogramGeometry({
        bins: BINS,
        marks: [],
        offAxis: null,
        curve: null,
        droppedLabel: '丢弃',
      }).viewBox,
    ),
  },
  {
    name: 'TimelineBand',
    units: unitsOf(
      timelineGeometry({ scale: 'time', rows: ROWS, span: null }).viewBox,
    ),
  },
]

describe('摆图那一格的列宽下限与图同档', () => {
  it.each(LANES)('$what 的列宽下限是一张图那一档', ({ file, at }) => {
    expect(declarationOf(styleOf(file), at, 'grid-template-columns')).toBe(
      TRACKS,
    )
  })

  // ⚠ 辅图不许靠画小来分主次：读不出数的图不是次要的图，是废图
  it.each(LANES)('$what 不把图的上限压到一档以下', ({ file, at }) => {
    const knob = declarationOf(styleOf(file), at, '--dt-ml-chart-max')

    expect(['', '100%']).toContain(knob)
  })
})

describe('刻度字在屏上不小于十三像素', () => {
  it.each(FIXED)('$name 摆进一格里的刻度字够大', ({ name, units }) => {
    const screen = screenSizeOf(textSizeOf(name), units, CHART_PX)

    expect(screen).toBeGreaterThanOrEqual(MIN_SCREEN_PX)
  })

  // ⚠ 载荷格的画幅宽随列数变（`68 + 列数 × 16 + 6`），跟着容器铺满的话三列的
  // 矩阵会把字放成 40px、二十列的又缩到 12.5px：它只能按每单位固定铺多少 px 画
  it('载荷格的宽度按每单位固定铺，不跟着容器铺满', () => {
    expect(declarationOf(styleOf('LoadingsGrid'), 'svg', 'width')).toBe(
      `calc(var(--dt-ml-loadings-units, ${DENSITY_UNITS}) * ${CHART_REM}rem / ${DENSITY_UNITS})`,
    )
  })

  it.each([3, 20])('载荷格 %i 列时刻度字一样大', (columns) => {
    const view = loadingsView({
      loadings: [Array.from({ length: columns }, () => 0.5)],
      loading_rows: ['pc1'],
      loading_columns: Array.from({ length: columns }, (_, seat) => `c${seat}`),
    })
    const wrapper = mount(LoadingsGrid, { props: { view } })
    const units = unitsOf(view.viewBox)
    const perUnit = CHART_PX / DENSITY_UNITS

    expect(wrapper.find('svg').attributes('style')).toContain(
      `--dt-ml-loadings-units: ${units}`,
    )
    expect(
      screenSizeOf(textSizeOf('LoadingsGrid'), units, units * perUnit),
    ).toBeGreaterThanOrEqual(MIN_SCREEN_PX)
  })

  // ⚠ 横条不是 SVG，它的字不随格子缩：这一条钉住这个前提，哪天它改画成 SVG
  // 就得跟着上面那套一起量
  it('横条那一族的字不吃 viewBox 的缩放', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: '甲', value: 1 }] },
    })

    expect(wrapper.find('svg').exists()).toBe(false)
  })
})
