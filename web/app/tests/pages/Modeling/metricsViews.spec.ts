/**
 * @fileoverview 评估结果的派发外壳与四种子视图：分类那一屏画全、按列名建键的
 * 那一份不查阈值表、交叉验证与重要性不再是空 div（设计规格 §5-21～24、R-34）。
 *
 * ⚠ 桩按**真实线形**建（`{metrics: {kind: 'metrics', …}}`）：摊平一层的桩会让
 * `previewOf` 与视图各自自洽地全绿，真跑起来却什么都不显示。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'

/** 真实 0 有 8 行（判对 5），真实 1 有 10 行（判对 9）。故意不对称。 */
const ASYMMETRIC = [
  [5, 3],
  [1, 9],
]

function payloadOf(body: Record<string, unknown>): Record<string, unknown> {
  return { metrics: { kind: 'metrics', ...body } }
}

function screen(body: Record<string, unknown>) {
  return mount(ResultView, { props: { payload: payloadOf(body) } })
}

const CLASSIFY = {
  task: 'classification',
  metrics: { accuracy: 14 / 18, precision: 9 / 12, recall: 9 / 10, f1: 0.8182 },
  labels: ['0', '1'],
  matrix: ASYMMETRIC,
}

describe('派发', () => {
  it('有混淆矩阵就画分类那一屏', () => {
    const wrapper = screen(CLASSIFY)

    expect(wrapper.find('.dt-ml-matrix__board').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-regress').exists()).toBe(false)
  })

  it('有真值预测对就画散点那一屏', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { r2: 0.9 },
      pairs: [
        [1, 1.1],
        [2, 1.9],
      ],
    })

    expect(wrapper.findAll('.dt-ml-scatter__dots')).toHaveLength(2)
    expect(wrapper.find('.dt-ml-matrix__board').exists()).toBe(false)
  })

  // ⚠ 交叉验证今天两张图的 v-if 都不成立，plots 区是个空 div（规格 §1.2）
  it('交叉验证的四个标量画成两条横条，不是空白', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: {
        folds: 4,
        score_mean: 0.82,
        score_std: 0.03,
        score_worst: 0.7,
      },
    })

    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(2)
    expect(wrapper.text()).toContain('最差一折')
    expect(wrapper.find('.dt-ml-regress').exists()).toBe(false)
  })

  it('交叉验证跑在分类模型上时仍画折数那一屏，不画空矩阵', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: {
        folds: 4,
        score_mean: 0.82,
        score_std: 0.03,
        score_worst: 0.7,
      },
    })

    expect(wrapper.find('.dt-ml-matrix__board').exists()).toBe(false)
    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(2)
  })

  it('按列名建键的那一份画成排行条，不摆指标卡', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { humidity: 0.12, power: 0.31 },
    })

    expect(wrapper.find('.dt-ml-metrics__list').exists()).toBe(false)
    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(2)
  })

  it('重要性按降序画，最重要的排在最上面', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { humidity: 0.12, power: 0.31, noise: -0.02 },
    })

    const names = wrapper.findAll('.dt-ml-bars__label').map((one) => one.text())
    expect(names).toEqual(['power', 'humidity', 'noise'])
  })

  it('打乱反而没变差的那几列标成噪声列，不只靠颜色', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { power: 0.31, noise: -0.02 },
    })

    expect(wrapper.findAll('.dt-ml-bars__piece--dropped')).toHaveLength(1)
    expect(wrapper.text()).toContain('噪声列')
  })

  it('只有几个标量、连图都画不出来时就只摆指标卡', () => {
    const wrapper = screen({ task: '', metrics: { mae: 3 } })

    expect(
      wrapper.findAll('.dt-ml-metrics__name').map((o) => o.text()),
    ).toEqual(['MAE'])
    expect(wrapper.find('.dt-ml-bars__row').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-scatter__dots').exists()).toBe(false)
  })

  it('交叉验证只带回平均分时不硬画最差那一条', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { folds: 2, score_mean: 0.5 },
    })

    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('波动与平均分之比')
  })

  // ⚠ 平均分是 0 时那个比值是除以零，不许印出 Infinity
  it('平均分为 0 时不报波动与平均分之比', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { folds: 3, score_mean: 0, score_std: 0.1, score_worst: -0.2 },
    })

    expect(wrapper.text()).not.toContain('波动与平均分之比')
    expect(wrapper.text()).not.toContain('Infinity')
  })

  it('某一列的重要性算不出来时排在最后，读数写「—」', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { power: 0.3, broken: null, humidity: 0.1 },
    })

    const names = wrapper.findAll('.dt-ml-bars__label').map((o) => o.text())
    const reads = wrapper.findAll('.dt-ml-bars__num').map((o) => o.text())
    expect(names).toEqual(['power', 'humidity', 'broken'])
    expect(reads).toEqual(['0.3', '0.1', '—'])
  })

  it('什么都没带回来时说一句，不是一片空白', () => {
    const wrapper = screen({ task: 'regression', metrics: {} })

    expect(wrapper.text()).toContain('这一步没有产出任何指标')
  })

  // ⚠ 0 分的条长就是 0，警示色与斜纹在唯一会触发它们的场景里一个都看不见——
  // 一行空轨道什么都没说，而树模型给没用到的列吐 0.0 是常态
  it('恰好 0 分的列不摆成空轨道，改成图下点名', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { power: 0.31, noise: 0, uptime: 0 },
    })

    const names = wrapper.findAll('.dt-ml-bars__label').map((o) => o.text())
    expect(names).toEqual(['power'])
    expect(wrapper.text()).toContain('这 2 列打乱后一分都没掉，模型没用上')
    expect(wrapper.text()).toContain('noise、uptime')
  })

  it('一列都没用上时空态说的是没用上，不是没算出来', () => {
    const wrapper = screen({ task: 'regression', metrics: { a: 0, b: 0 } })

    expect(wrapper.text()).toContain('这个模型没有用上任何一列')
    expect(wrapper.text()).not.toContain('没有算出任何一列的重要性')
  })

  it('没用上的列多到点不过来时补一句还有多少', () => {
    const many = Object.fromEntries(
      Array.from({ length: 15 }, (_, seat) => [`c${seat}`, 0]),
    )
    const wrapper = screen({
      task: 'regression',
      metrics: { power: 0.3, ...many },
    })

    expect(wrapper.text()).toContain('这 15 列打乱后一分都没掉')
    expect(wrapper.text()).toContain('另有 3 列')
  })
})

describe('键空间冲突', () => {
  // ⚠ 一列恰好叫 mape 时，无量纲的 ΔR²=0.12 会被印成「0.12%」（规格 R-34）
  it('一列叫 mape 的重要性值不许被印成百分数', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { mape: 0.12, humidity: 0.3 },
    })

    const names = wrapper.findAll('.dt-ml-bars__label').map((o) => o.text())
    const reads = wrapper.findAll('.dt-ml-bars__num').map((o) => o.text())
    expect(names).toEqual(['humidity', 'mape'])
    expect(reads).toEqual(['0.3', '0.12'])
  })

  it('一列叫 r2 的重要性值不许被套上 R² 的阈值染色', () => {
    const wrapper = screen({
      task: 'regression',
      metrics: { r2: 0.95, humidity: 0.3 },
    })

    expect(wrapper.find('.dt-ml-metrics__list').exists()).toBe(false)
    const names = wrapper.findAll('.dt-ml-bars__label').map((o) => o.text())
    expect(names).toEqual(['r2', 'humidity'])
  })
})

describe('分类这一屏', () => {
  it('每类的支持度与 F1 都在表里', () => {
    const wrapper = screen(CLASSIFY)

    const text = wrapper.text()
    expect(text).toContain('支持度')
    // 真实 1 那一类：F1 = 2 × 0.75 × 0.9 ÷ 1.65
    expect(text).toContain('0.8182')
    // 真实 0 那一类：F1 = 2 × (5/6) × 0.625 ÷ (5/6 + 0.625)
    expect(text).toContain('0.7143')
  })

  it('真实占比与预测占比并排画，两侧各有名字', () => {
    const wrapper = screen(CLASSIFY)

    const legend = wrapper.findAll('.dt-ml-bars__keys li').map((o) => o.text())
    expect(legend).toContain('真实占比')
    expect(legend).toContain('预测占比')
  })

  it('精确率与召回率对上哪一类，就给哪一类挂正类徽标', () => {
    const wrapper = screen(CLASSIFY)

    expect(wrapper.text()).toContain('正类：1')
  })

  // ⚠ 正类可能一行都没出现过：此时不画徽标，改成一条 danger 说明（规格 R-20）
  it('正类不在类目里时不画徽标，出一条明说的告警', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: { accuracy: 1, precision: null, recall: null, f1: null },
      labels: ['0'],
      matrix: [[6]],
    })

    expect(wrapper.text()).toContain('一次都没出现过')
    expect(wrapper.text()).not.toContain('正类：')
  })

  it('两类的精确率与召回率一样时说认不出正类，不硬挑一个', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: { accuracy: 0.625, precision: 0.625, recall: 0.625, f1: 0.625 },
      labels: ['0', '1'],
      matrix: [
        [5, 3],
        [3, 5],
      ],
    })

    expect(wrapper.text()).toContain('认不出哪一类是正类')
    expect(wrapper.text()).not.toContain('正类：')
  })

  it('测试集一行都没有时明说算不出来，不是一片空白', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: { accuracy: null, precision: null, recall: null, f1: null },
      labels: [],
      matrix: [],
    })

    expect(wrapper.text()).toContain('一行都没有')
    expect(wrapper.find('.dt-ml-matrix__board').exists()).toBe(false)
  })

  it('只有一类时矩阵照画，那一类就是正类', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: { accuracy: 1, precision: 1, recall: 1, f1: 1 },
      labels: ['1'],
      matrix: [[7]],
    })

    expect(wrapper.find('.dt-ml-matrix__board').exists()).toBe(true)
    expect(wrapper.text()).toContain('正类：1')
  })

  it('分类的四个指标仍摆成指标卡，中文名照旧', () => {
    const wrapper = screen(CLASSIFY)

    const names = wrapper
      .findAll('.dt-ml-metrics__name')
      .map((one) => one.text())
    expect(names).toEqual(['准确率', '精确率', '召回率', 'F1'])
  })
})
