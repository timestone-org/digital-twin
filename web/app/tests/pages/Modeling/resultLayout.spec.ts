/**
 * @fileoverview 两屏评估视图的版式：回归的主体图 / 辅图两档，分类的三块共用一
 * 条右缘（结果展示规格 §3.2）。
 *
 * ⚠ 版式在挂载测试里量不出来（happy-dom 不排版），而它坏起来是无声的：三张图
 * 被 flex 挤成同一档时，图上的刻度字跟着 viewBox 一起缩到 6px 上下，截图上一个
 * 数都读不出来，代码却一行都不红。故这里一半钉 DOM 的分区、一半读样式的取值。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'
import ScatterPlot from '@/pages/Modeling/Canvas/components/ScatterPlot.vue'

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

/** 可被区覆盖的那个上限；三个图元件共用一个名字。 */
const KNOB = '--dt-ml-chart-max'

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

/** 某一条 CSS 块里给这个旋钮设的值。没设就是空串。 */
function knobOf(style: string, selector: string): string {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(style)
  const found = new RegExp(`${KNOB}\\s*:\\s*([^;]+)`).exec(block?.[1] ?? '')
  return found?.[1]?.trim() ?? ''
}

function payloadOf(body: Record<string, unknown>): Record<string, unknown> {
  return { metrics: { kind: 'metrics', ...body } }
}

const REGRESSION = payloadOf({
  task: 'regression',
  metrics: { r2: 0.87, residual_mean: 0.1, residual_std: 1.8 },
  pairs: [
    [1, 1.2],
    [2, 1.9],
    [3, 3.4],
  ],
  residual_bins: [
    [-1, 0, 2],
    [0, 1, 1],
  ],
})

describe('回归这一屏分主体图与辅图', () => {
  // ⚠ 主体图是残差对预测值那张：它答的是「错在哪」。真值预测散点答的「准不
  // 准」，指标卡上的 R² 已经说过一遍了
  it('主体区摆的是残差对预测值那张，且只有它一张', () => {
    const wrapper = mount(ResultView, { props: { payload: REGRESSION } })
    const lead = wrapper.find('.dt-ml-regress__lead')

    expect(lead.findAll('figcaption')).toHaveLength(1)
    expect(lead.findComponent(ScatterPlot).props('mode')).toBe('residual')
    expect(lead.findComponent(ScatterPlot).props('caption')).toContain('对残差')
  })

  it('另外两张都在辅图那一格里', () => {
    const wrapper = mount(ResultView, { props: { payload: REGRESSION } })
    const aux = wrapper
      .findAll('.dt-ml-regress__aux figcaption')
      .map((one) => one.text())

    expect(aux).toHaveLength(2)
    expect(aux[0]).toContain('对预测值')
    expect(aux[1]).toContain('残差分布')
  })

  // ⚠ 三张图挤在一个 flex-wrap 里时，宽度由图注那行字的长短决定：改一个字，
  // 版式就变一档。分区之后主体图独占一行，辅图各占一格
  it('两个区各自是一块，图不再被同一排挤扁', () => {
    const wrapper = mount(ResultView, { props: { payload: REGRESSION } })

    expect(wrapper.findAll('.dt-ml-regress__lead')).toHaveLength(1)
    expect(wrapper.findAll('.dt-ml-regress__aux')).toHaveLength(1)
  })

  it('没有散点时主体区整个不摆，不留一道空缝', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: payloadOf({
          task: 'regression',
          metrics: { r2: 0.5 },
          residual_bins: [[0, 1, 3]],
        }),
      },
    })

    expect(wrapper.find('.dt-ml-regress__lead').exists()).toBe(false)
    expect(wrapper.findAll('.dt-ml-regress__aux figcaption')).toHaveLength(1)
  })

  // ⚠ 上限焊在图元件里时这两档推不动它，会被静默截回同一个数
  it('两档上限由这两个区各自给，且不是同一档', () => {
    const style = styleOf('RegressionMetricsView')
    const lead = knobOf(style, '&__lead')
    const aux = knobOf(style, '&__aux')

    expect(lead).toContain('44rem')
    expect(aux).not.toBe('')
    expect(aux).not.toBe(lead)
  })
})

describe('分类这一屏三块共用一条右缘', () => {
  const CLASSIFY = payloadOf({
    task: 'classification',
    metrics: { accuracy: 0.9 },
    labels: ['A', 'B'],
    matrix: [
      [9, 1],
      [2, 8],
    ],
  })

  it('矩阵、占比条、逐类总账摞在同一块里', () => {
    const wrapper = mount(ResultView, { props: { payload: CLASSIFY } })
    const stack = wrapper.find('.dt-ml-clf__stack')

    expect(stack.find('.dt-ml-matrix__board').exists()).toBe(true)
    expect(stack.find('.dt-ml-bars__rows').exists()).toBe(true)
    expect(stack.find('.dt-ml-clf__ledger').exists()).toBe(true)
  })

  // ⚠ 热力表按列宽自然排布，另两块若各自铺满整屏，右边缘会从矩阵旁探出一大截
  it('那一块的宽度跟着矩阵走，不铺满整屏', () => {
    const style = styleOf('ClassificationMetricsView')
    const block = /&__stack\s*\{([^}]*)\}/.exec(style)

    expect(block?.[1]).toContain('width: fit-content')
    expect(block?.[1]).toContain('max-width: 100%')
  })

  // ⚠ 长长的告警与图注不进这一块：它们的最大内容宽度是一整行字，会把这一块
  // 撑回整屏宽，右缘就又对不齐了
  it('告警与那行小字摆在这一块外面', () => {
    const wrapper = mount(ResultView, { props: { payload: CLASSIFY } })
    const stack = wrapper.find('.dt-ml-clf__stack')

    expect(stack.find('.dt-ml-clf__note').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-clf__note').exists()).toBe(true)
  })
})
