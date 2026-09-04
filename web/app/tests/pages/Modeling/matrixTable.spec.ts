/**
 * @fileoverview 混淆矩阵画出来的样子：格子里的数、右侧与底部的边栏、退化档的
 * 说明文字，以及「颜色不作唯一编码」那两重编码真在样式里。
 *
 * ⚠ 斜纹与热力底色只活在 scoped SCSS 里，happy-dom 不套用样式，挂载断言看不见
 * 它们；少了这重编码，判对与判错在灰度下就只剩一片一样的格子（规格 §2-P6）。
 * ⚠ 插槽名与 prop 名写错时 typecheck 与 lint 双双放行，只有挂载后数格子能兜住。
 */
import { DtTooltip } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import MatrixTable from '@/pages/Modeling/Canvas/components/MatrixTable.vue'

const SOURCE = readFileSync(
  join(
    process.cwd(),
    'app/src/pages/Modeling/Canvas/components/MatrixTable.vue',
  ),
  'utf8',
)

/** 真实 0 有 8 行（判对 5），真实 1 有 10 行（判对 9）。故意不对称。 */
const ASYMMETRIC = [
  [5, 3],
  [1, 9],
]

/** 错格的行数很不均匀：1 行的错与 50 行的错落在同一张图上。 */
const LOPSIDED = [
  [90, 1, 0],
  [0, 50, 500],
  [0, 0, 100],
]

function heatTexts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('.dt-ml-matrix__cell--hit, .dt-ml-matrix__cell--miss')
    .map((cell) => cell.text())
}

/** 某一格的热力 alpha。没上色的格子给 0。 */
function alphaOf(wrapper: ReturnType<typeof mount>, text: string): number {
  const cell = wrapper
    .findAll('.dt-ml-matrix__cell--hit, .dt-ml-matrix__cell--miss')
    .find((one) => one.text() === text)
  const found = /--cell-alpha:\s*([\d.]+)/.exec(cell?.attributes('style') ?? '')
  return Number(found?.[1] ?? 0)
}

/** 全部错格的 alpha，从浅到深。 */
function missAlphas(wrapper: ReturnType<typeof mount>): number[] {
  return wrapper
    .findAll('.dt-ml-matrix__cell--miss')
    .map((cell) => {
      const found = /--cell-alpha:\s*([\d.]+)/.exec(
        cell.attributes('style') ?? '',
      )
      return Number(found?.[1] ?? 0)
    })
    .filter((alpha) => alpha > 0)
    .sort((left, right) => left - right)
}

describe('矩阵画出来的内容', () => {
  it('每一格的计数都是页面上的文字', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC },
    })

    expect(heatTexts(wrapper)).toEqual(['5', '3', '1', '9'])
  })

  it('右侧边栏挂每类的召回率与支持度', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC },
    })
    const text = wrapper.text()

    expect(text).toContain('召回率')
    expect(text).toContain('支持度')
    expect(text).toContain('0.625')
    expect(text).toContain('0.9')
  })

  it('底部边栏挂每类的精确率与判成的行数，右下角是总数与准确率', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC },
    })
    const text = wrapper.text()

    expect(text).toContain('精确率')
    expect(text).toContain('0.8333')
    expect(text).toContain('0.75')
    // ⚠ 比率不换算成百分数：乘 100 会把 0.923077 推进定点档，印成 92.3077%
    expect(text).not.toContain('%')
    expect(text).toContain('判成这一类')
    expect(text).toContain('共 18 行，判对 14 行，准确率 0.7778')
  })

  it('表头是列出来的类目，走 DtTable 而不是手写表格', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['低', '高'], matrix: ASYMMETRIC },
    })

    expect(wrapper.findAll('th').map((head) => head.text())).toEqual([
      '真实＼判成',
      '低',
      '高',
      '召回率',
      '支持度',
    ])
    expect(SOURCE).toContain('<DtTable')
    expect(wrapper.find('.dt-table').exists()).toBe(true)
  })

  it('行头的全名挂在 DtTooltip 上，长类名截断是版式的事', () => {
    const long = '1#冷冻水泵出口温度异常偏高的那一类样本'
    const wrapper = mount(MatrixTable, {
      props: { labels: [long, 'b'], matrix: ASYMMETRIC },
    })

    expect(wrapper.find('.dt-ml-matrix__text').text()).toBe(long)
    expect(wrapper.findComponent(DtTooltip).props('content')).toContain(long)
  })

  it('图下那行结论是可见文字，不是只挂在提示里', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC, caption: '测试段' },
    })

    expect(wrapper.find('.dt-ml-matrix__sum').text()).toContain('准确率')
    expect(wrapper.find('.dt-ml-matrix__caption').text()).toBe('测试段')
  })

  it('每一格都挂着「真实什么判成什么」的说明', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC },
    })
    const first = wrapper.find('.dt-ml-matrix__cell--miss')

    expect(first.attributes('title')).toBe(
      '真实「0」判成「1」：3 行，占这一行 0.375',
    )
  })
})

describe('颜色不作唯一编码', () => {
  it('判错的格子除了颜色还有斜纹，判对的加粗', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1'], matrix: ASYMMETRIC },
    })

    expect(wrapper.findAll('.is-striped')).toHaveLength(2)
    expect(SOURCE).toContain('repeating-linear-gradient')
    expect(SOURCE).toContain('font-weight: 600')
  })

  it('计数为 0 的格子不上色也不加斜纹', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['0', '1'],
        matrix: [
          [6, 0],
          [4, 0],
        ],
      },
    })
    const blanks = wrapper
      .findAll('.dt-ml-matrix__cell--hit, .dt-ml-matrix__cell--miss')
      .filter((cell) => cell.text() === '0')

    expect(blanks).toHaveLength(2)
    expect(wrapper.findAll('.is-striped')).toHaveLength(1)
    expect(blanks.every((cell) => cell.attributes('style') === undefined)).toBe(
      true,
    )
  })

  it('对角格的深浅就是这一类的召回率', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['0', '1'],
        matrix: [
          [3, 1],
          [50, 950],
        ],
      },
    })
    const alphas = wrapper
      .findAll('.dt-ml-matrix__cell--hit, .dt-ml-matrix__cell--miss')
      .map((cell) => cell.attributes('style') ?? '')

    expect(alphas[0]).toContain('--cell-alpha: 0.57')
    expect(alphas[3]).toContain('--cell-alpha: 0.69')
  })

  it('深底上的字换成压在实心底上的深墨色，浅底上不换', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['A', 'B', 'C'], matrix: LOPSIDED },
    })
    const deepTexts = wrapper.findAll('.is-deep').map((cell) => cell.text())

    // 90 与 100 召回率接近满；50 那一类召回率只有 0.09，对角格也浅着
    expect(deepTexts).toEqual(['90', '100'])
    expect(SOURCE).toContain('var(--text-on-emphasis)')
  })

  // ⚠ 这一条是返修的锚：错格按行内占比线性铺时，整片错格挤在 α∈[0.13,0.27]
  // 里，1 行与 15 行的明度差不到 0.05，肉眼分不开
  it('错格里最深的一格与最浅的一格必须拉得开', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['A', 'B', 'C'],
        matrix: [
          [500, 1, 4],
          [50, 400, 2],
          [3, 1, 300],
        ],
      },
    })
    const alphas = missAlphas(wrapper)
    const shallow = alphas[0] ?? 0
    const deepest = alphas[alphas.length - 1] ?? 0

    // 老映射（错格按行内占比线性铺）在这张夹具上只拉开 0.065
    expect(alphas).toHaveLength(6)
    expect(deepest - shallow).toBeGreaterThan(0.35)
  })

  // ⚠ 按**每行**的错格最大值归一时，这两格都会归成满格：一行只错了 1 行，
  // 会画得和错了 500 行的那一行一样重
  it('只错了 1 行的格子不许画得和错了 500 行的一样重', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['A', 'B', 'C'], matrix: LOPSIDED },
    })
    const one = alphaOf(wrapper, '1')
    const many = alphaOf(wrapper, '500')

    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThan(0.2)
    expect(many).toBeGreaterThan(0.55)
    expect(many - one).toBeGreaterThan(0.4)
  })

  // ⚠ 危险色的明度比成功色低得多：判错格铺到 0.72 时，暗色预设下白字只剩
  // 4.4:1、换深墨更只有 3.3:1。六套预设逐档实测，判错格的上限得单独压到 0.58，
  // 而且一格都不许换深墨（换了就是把字压进中明度带）
  it('判错格的上限比判对格低一档，且从不换深墨色', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['A', 'B', 'C'], matrix: LOPSIDED },
    })

    expect(alphaOf(wrapper, '500')).toBeLessThanOrEqual(0.58)
    expect(alphaOf(wrapper, '100')).toBeGreaterThan(0.58)
    expect(
      wrapper.findAll('.dt-ml-matrix__cell--miss.is-deep'),
    ).toHaveLength(0)
    expect(SOURCE).toContain('color: var(--text-primary)')
  })

  it('图例把错格那把尺子的刻度写出来，「越深」才有口径', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['A', 'B', 'C'], matrix: LOPSIDED },
    })

    expect(wrapper.find('.dt-ml-matrix__keys').text()).toContain(
      '最深的一格 500 行',
    )
  })

  it('一格都没判错时，图例照实说没有错格', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['0', '1'],
        matrix: [
          [6, 0],
          [0, 4],
        ],
      },
    })

    expect(wrapper.find('.dt-ml-matrix__keys').text()).toContain(
      '这一次一格都没判错',
    )
    expect(wrapper.findAll('.is-striped')).toHaveLength(0)
  })

  // ⚠ 六套预设里只有这一对色相角差处处 ≥120°：accent-primary 配 state-warning
  // 在熔岩橙下只差 47°，两半会塌成同一个色相族
  it('判对与判错用的是两个色相拉得开的令牌', () => {
    expect(SOURCE).toContain('--cell-hue: var(--state-success)')
    expect(SOURCE).toContain('--cell-hue: var(--state-danger)')
  })

  it('热力格坐在一层不透明实底上，不直接叠在会动的画布上', () => {
    expect(SOURCE).toContain('background: var(--surface-base)')
    expect(SOURCE).toContain('color-mix(')
  })

  // ⚠ 只有真浏览器量得出来：没有这一对，没有字的那两个角上会浮出一块矮半截的
  // 色块，而 happy-dom 不套用样式，挂载断言看不见
  it('格子撑满整行，空格子不会缩成半截色块', () => {
    expect(SOURCE).toContain('height: 1px')
    expect(SOURCE).toContain('height: 100%')
  })
})

describe('退化的那些档', () => {
  it('1×1 也画得出来', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['1'], matrix: [[7]] },
    })

    expect(heatTexts(wrapper)).toEqual(['7'])
    expect(wrapper.text()).toContain('共 7 行，判对 7 行，准确率 1')
  })

  it('20×20 的上限照画', () => {
    const labels = Array.from({ length: 20 }, (_, seat) => String(seat))
    const wrapper = mount(MatrixTable, {
      props: {
        labels,
        matrix: labels.map((_, row) =>
          labels.map((__, column) => (row === column ? 2 : 1)),
        ),
      },
    })

    expect(heatTexts(wrapper)).toHaveLength(400)
    expect(wrapper.findAll('th')).toHaveLength(23)
  })

  it('类别超过上限时不硬画，照实说画不下', () => {
    const labels = Array.from({ length: 21 }, (_, seat) => String(seat))
    const wrapper = mount(MatrixTable, {
      props: {
        labels,
        matrix: labels.map((_, row) =>
          labels.map((__, column) => (row === column ? 2 : 1)),
        ),
      },
    })

    expect(wrapper.find('.dt-table').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-matrix__note').text()).toBe(
      '类别有 21 个，超过 20 个的上限，混淆矩阵画不下',
    )
    expect(wrapper.text()).toContain('准确率')
  })

  it('一个类目都没有时给一句空态，不是一片空白', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: [], matrix: [], emptyText: '这一步不是分类评估' },
    })

    expect(wrapper.text()).toContain('这一步不是分类评估')
    expect(wrapper.find('.dt-table').exists()).toBe(false)
  })

  it('全零矩阵：格子画得出来，准确率照实说无定义', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['0', '1'],
        matrix: [
          [0, 0],
          [0, 0],
        ],
      },
    })

    expect(heatTexts(wrapper)).toEqual(['0', '0', '0', '0'])
    expect(wrapper.text()).toContain('这份测试集里一行都没有，准确率无定义')
    expect(wrapper.text()).toContain('—')
  })

  it('只有一类真实出现过：那一类的召回率无定义而不是 0', () => {
    const wrapper = mount(MatrixTable, {
      props: {
        labels: ['0', '1'],
        matrix: [
          [6, 4],
          [0, 0],
        ],
      },
    })
    const recalls = wrapper
      .findAll('.dt-ml-matrix__cell--edge')
      .map((cell) => cell.text())

    expect(recalls).toContain('—')
    expect(wrapper.text()).toContain('共 10 行，判对 6 行，准确率 0.6')
  })

  it('维度对不上时不画格子，把话说清楚', () => {
    const wrapper = mount(MatrixTable, {
      props: { labels: ['0', '1', '2'], matrix: ASYMMETRIC },
    })

    expect(wrapper.find('.dt-table').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-matrix__note').text()).toContain('对不上')
  })

  it('类名极长时行头截断的口径是 8rem', () => {
    expect(SOURCE).toContain('max-width: 8rem')
    expect(SOURCE).toContain('text-overflow: ellipsis')
  })
})
