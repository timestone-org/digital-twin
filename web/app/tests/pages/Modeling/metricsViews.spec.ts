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

  // ⚠ 概率侧的阈值滑杆会在同一屏上另摆一张随阈值走的矩阵：两张长得一模一样，
  // 不写清哪一张是打分结果，读者会把假设当成实得
  it('这一张矩阵写明数的是打分真判出来的那份结果', () => {
    const text = screen(CLASSIFY).find('.dt-ml-matrix__caption').text()

    expect(text).toContain('这一次打分真判出来的那份结果')
    expect(text).toContain('不是换个阈值之后的假设')
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

describe('同屏已经画出来的事不许再说没有', () => {
  /** 这一路带回的讲解块；端口名与摘要那一路一致（五个评估算子都叫 metrics）。 */
  function blockOf(over: Record<string, unknown> = {}) {
    return {
      kind: 'breakdown',
      zone: 'charts',
      port: 'metrics',
      title: '逐折分数',
      tier: 1,
      payload: {
        label: '每折的分',
        items: [
          { name: '第 1 折', value: 0.9 },
          { name: '第 2 折', value: 0.7 },
        ],
      },
      ...over,
    }
  }

  /**
   * 有讲解时那张表默认是收起来的，评估那一屏就摆在里面——不展开的话，下面这
   * 几条断言只是在一片空白上做的，怎么改都绿。
   */
  async function withBlocks(
    body: Record<string, unknown>,
    blocks: Record<string, unknown>[],
  ) {
    const wrapper = mount(ResultView, {
      props: {
        payload: payloadOf(body),
        report: { blocks, dropped: [], note: '' },
      },
    })
    await wrapper.find('.dt-ml-result__toggle').trigger('click')
    return wrapper
  }

  const FOLD_METRICS = {
    task: 'regression',
    metrics: { folds: 3, score_mean: 0.82, score_std: 0.03, score_worst: 0.7 },
  }

  it('逐折分数已经画在同屏时，不再说它没随摘要带回来', async () => {
    const wrapper = await withBlocks(FOLD_METRICS, [blockOf()])

    expect(wrapper.text()).toContain('第 1 折')
    expect(wrapper.text()).toContain('最差一折')
    expect(wrapper.text()).not.toContain('逐折的分数没有随这份摘要带回来')
  })

  it('老运行只有那四个标量时照旧说清逐折的分没带回来', () => {
    const wrapper = screen(FOLD_METRICS)

    expect(wrapper.text()).toContain('逐折的分数没有随这份摘要带回来')
  })

  it('指标搬进块里之后不许再报「没有产出任何指标」', async () => {
    const wrapper = await withBlocks({ task: 'regression', metrics: {} }, [
      blockOf({ title: '特征重要性' }),
    ])

    expect(wrapper.text()).toContain('特征重要性')
    expect(wrapper.text()).not.toContain('这一步没有产出任何指标')
  })

  it('摘要与块双空才是真的什么都没有', async () => {
    const wrapper = await withBlocks({ task: 'regression', metrics: {} }, [
      blockOf({ port: 'other', title: '别的一路的账' }),
    ])

    expect(wrapper.text()).toContain('这一步没有产出任何指标')
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

/**
 * A 强 B 弱，且弱的那一类排在后面：默认序若没生效，行序会与矩阵一模一样，
 * 用矩阵序的夹具是看不出来的。
 */
const RANKED = {
  task: 'classification',
  metrics: { accuracy: 0.8947 },
  labels: ['A', 'B'],
  matrix: [
    [90, 4],
    [8, 12],
  ],
}

/** 逐类总账那张表的行，按当前顺序。 */
function ledgerRows(wrapper: ReturnType<typeof screen>): string[][] {
  return wrapper
    .findAll('.dt-ml-clf__ledger tbody tr')
    .map((row) => row.findAll('td').map((cell) => cell.text()))
}

describe('逐类总账', () => {
  // ⚠ 矩阵边栏与列脚已经把精确率与召回率印过一遍，那两处贴着行、贴着列，
  // 口径由位置说清楚；表这一处再印一遍就是同一份账印两遍（规格 §2-P1）
  it('不复述矩阵已经印过的精确率与召回率', () => {
    const wrapper = screen(RANKED)

    const heads = wrapper
      .findAll('.dt-ml-clf__ledger th')
      .map((head) => head.text())
    expect(heads).toEqual(['类目', '支持度', 'F1', '最常错判成'])
  })

  it('默认按 F1 从低到高排，最弱的一类排在最上面', () => {
    const wrapper = screen(RANKED)

    expect(ledgerRows(wrapper).map((row) => row[0])).toEqual(['B', 'A'])
  })

  it('点表头换一列排', async () => {
    const wrapper = screen(RANKED)
    const heads = wrapper.findAll('.dt-ml-clf__ledger .dt-table__sort')

    expect(heads.map((head) => head.text())).toEqual([
      '支持度',
      'F1',
      '最常错判成',
    ])

    await heads[2]?.trigger('click')

    expect(ledgerRows(wrapper).map((row) => row[0])).toEqual(['A', 'B'])

    await heads[2]?.trigger('click')

    expect(ledgerRows(wrapper).map((row) => row[0])).toEqual(['B', 'A'])
  })

  // ⚠ 这是整张表上唯一一件矩阵读不出来的事：在矩阵里它是一行中最深的那一格
  it('印这一类错得最多的去向与行数', () => {
    const wrapper = screen(RANKED)
    const rows = ledgerRows(wrapper)

    expect(rows[0]).toEqual(['B', '20', '0.6667', 'A 8 行'])
    expect(rows[1]).toEqual(['A', '94', '0.9375', 'B 4 行'])
  })

  it('一格都没错的类目写「没有错判」，不留一格空白', () => {
    const wrapper = screen({
      task: 'classification',
      metrics: { accuracy: 1 },
      labels: ['A', 'B'],
      matrix: [
        [9, 0],
        [0, 6],
      ],
    })

    expect(ledgerRows(wrapper).map((row) => row[3])).toEqual([
      '没有错判',
      '没有错判',
    ])
  })
})
