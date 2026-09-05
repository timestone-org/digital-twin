/**
 * @fileoverview 公式树的纯 ASCII 序列化与折行切分，以及四个建模算子的骨架表：
 * 代入态取不到实参时必须降级成符号态并说清是哪一种「没有」，而不是印一串空。
 */
import { describe, expect, it } from 'vitest'

import {
  cases,
  formulaText,
  frac,
  nameOf,
  numOf,
  opOf,
  run,
  sqrt,
  sum,
  termItems,
  varOf,
  warnOf,
} from '@/pages/Modeling/Canvas/scripts/formula'
import type { FormulaSpec } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import {
  formulaCodes,
  formulasOf,
} from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import type {
  FramePreview,
  ModelPreview,
  PortPreview,
} from '@/pages/Modeling/Canvas/scripts/preview'

function model(patch: Partial<ModelPreview> = {}): ModelPreview {
  return {
    kind: 'model',
    algo: 'linear_regression',
    task: 'regression',
    featureKeys: ['温度', '负荷'],
    targetKey: 'y',
    hyperParams: [],
    isFitted: true,
    isFittedTrimmed: false,
    coefficients: [
      ['温度', 3.21],
      ['负荷', -0.84],
    ],
    classes: [],
    intercept: 1403.2,
    servingChannel: 'json',
    ...patch,
  }
}

function frame(rows: number): FramePreview {
  return {
    kind: 'frame',
    rowCount: rows,
    colCount: 3,
    columns: [],
    indexName: '时刻',
    indexHead: [],
    head: [],
    isRowsTruncated: false,
    isColsTruncated: false,
    provenance: {
      tableCodes: [],
      since: null,
      until: null,
      isTruncated: false,
    },
  }
}

function split(train: number, test: number): PortPreview[] {
  return [
    { port: 'train', preview: frame(train) },
    { port: 'test', preview: frame(test) },
  ]
}

function pick(specs: FormulaSpec[], id: string): FormulaSpec {
  const found = specs.find((spec) => spec.id === id)
  if (found === undefined) throw new Error(`没有这条公式：${id}`)
  return found
}

describe('公式折成纯 ASCII', () => {
  it('线性式折成能直接粘进 Excel 的一行', () => {
    const line = run(
      nameOf('ŷ'),
      opOf('='),
      numOf(1403.2),
      opOf('+'),
      numOf(3.21),
      opOf('·'),
      varOf('温度'),
      opOf('−'),
      numOf(0.84),
      opOf('·'),
      varOf('负荷'),
    )

    expect(formulaText([line])).toBe('y = 1403.2 + 3.21*温度 - 0.84*负荷')
  })

  it('分式两侧各自套括号，优先级读不错', () => {
    const nodes = [
      run(varOf('x'), opOf('+')),
      frac([run(varOf('a'), opOf('+'), varOf('b'))], [run(varOf('c'))]),
    ]

    expect(formulaText(nodes)).toBe('x + (a + b) / (c)')
  })

  it('根号与 Σ 折成函数调用，上下限进括号', () => {
    expect(formulaText([sqrt([run(varOf('x'), opOf('+'), varOf('1'))])])).toBe(
      'sqrt(x + 1)',
    )
    expect(formulaText([sum('i = 1', 'n', [run(varOf('eᵢ²'))])])).toBe(
      'sum(i = 1..n, ei^2)',
    )
  })

  it('分档式折成一对花括号，每档带上它的条件', () => {
    const node = cases([
      { when: 'p(x) ≥ 0.5', then: [run(varOf('c₁'))] },
      { when: 'p(x) < 0.5', then: [run(varOf('c₀'))] },
    ])

    expect(formulaText([node])).toBe('{ c1 若 p(x) >= 0.5; c0 若 p(x) < 0.5 }')
  })

  it('取整符号成对翻成 floor(…)', () => {
    expect(formulaText([run(varOf('⌊N·r⌋'))])).toBe('floor(N*r)')
  })

  it('组合符写的 ŷ 也翻得出来', () => {
    // 一个 y 加一个组合抑扬符：肉眼与 U+0177 完全一样，逐字翻会漏
    expect(formulaText([run(nameOf('y\u0302'))])).toBe('y')
  })

  it('空文本的项不占位，不会在式子里留出一个空格', () => {
    expect(formulaText([run(varOf(''), varOf('x'))])).toBe('x')
  })

  it('认不出的字形原样留着，不悄悄吞掉', () => {
    expect(formulaText([run(varOf('θ'))])).toBe('θ')
  })
})

describe('折行只发生在运算符前', () => {
  it('每一项以运算符打头，变量名不会被拆到两行', () => {
    const items = termItems([
      nameOf('ŷ'),
      opOf('='),
      numOf(1403.2),
      opOf('+'),
      numOf(3.21),
      opOf('·'),
      varOf('温度'),
    ])

    expect(items.map((item) => item.map((term) => term.text).join(''))).toEqual(
      ['ŷ', '=1403.2', '+3.21·温度'],
    )
  })

  it('乘号不断行——断在它上面会把「3.21·温度」劈成两半', () => {
    const items = termItems([numOf(3.21), opOf('·'), varOf('温度')])

    expect(items).toHaveLength(1)
  })

  it('一项都没有时给空清单，不给一个空组', () => {
    expect(termItems([])).toEqual([])
  })

  it('首项就是运算符时不冒出一个空组', () => {
    expect(termItems([opOf('+'), numOf(1)])).toHaveLength(1)
  })
})

describe('线性回归的公式', () => {
  const ports: PortPreview[] = [{ port: 'model', preview: model() }]

  it('代入态就是那一行能抄走的式子', () => {
    const spec = pick(
      formulasOf('linear_regression', { blocks: [], ports, config: {} }),
      'predict',
    )

    expect(spec.filled).not.toBeNull()
    expect(formulaText(spec.filled ?? [])).toBe(
      'y = 1403.2 + 3.21*温度 - 0.84*负荷',
    )
    expect(spec.isOpen).toBe(true)
  })

  it('符号态里 Σ 的上下限都在', () => {
    const spec = pick(
      formulasOf('linear_regression', { blocks: [], ports, config: {} }),
      'predict',
    )

    expect(formulaText(spec.symbolic)).toBe('y = b0 + sum(j = 1..p, bj*xj)')
  })

  it('负系数拆成减号，不印成「+ -0.84」', () => {
    const spec = pick(
      formulasOf('linear_regression', { blocks: [], ports, config: {} }),
      'predict',
    )

    expect(formulaText(spec.filled ?? [])).not.toContain('+ -')
  })

  it('极小的系数走指数记法而不是一片 0', () => {
    const tiny = model({ coefficients: [['温度', 3e-5]], intercept: 0 })
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports: [{ port: 'model', preview: tiny }],
        config: {},
      }),
      'predict',
    )

    expect(formulaText(spec.filled ?? [])).toBe('y = 0 + 3e-5*温度')
  })

  it('没有截距时第一项顶上来，符号不丢', () => {
    const headless = model({
      intercept: null,
      coefficients: [['温度', -3.21]],
    })
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports: [{ port: 'model', preview: headless }],
        config: {},
      }),
      'predict',
    )

    expect(formulaText(spec.filled ?? [])).toBe('y = - 3.21*温度')
  })

  it('一个系数都没有时只出符号态，并说清是哪一种「没有」', () => {
    const bare = model({ coefficients: [] })
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports: [{ port: 'model', preview: bare }],
        config: {},
      }),
      'predict',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toBe('这个模型没有可读的系数')
  })

  it('摘要被削掉系数与压根没系数是两句话', () => {
    const trimmed = model({ coefficients: [], isFittedTrimmed: true })
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports: [{ port: 'model', preview: trimmed }],
        config: {},
      }),
      'predict',
    )

    expect(spec.fallback).toContain('摘要太大')
  })

  it('连模型端口都没有时也不空着', () => {
    const spec = pick(
      formulasOf('linear_regression', { blocks: [], ports: [], config: {} }),
      'predict',
    )

    expect(spec.fallback).toBe('这一步的结果摘要里没有模型，代不进实参')
  })

  it('L2 惩罚项把 alpha 代进去', () => {
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports,
        config: { regularization: 'ridge', ridge_alpha: 0.5 },
      }),
      'fit',
    )

    expect(formulaText(spec.filled ?? [])).toBe(
      'b = argmin sum(i = 1..n, ei^2) + 0.5 sum(j = 1..p, bj^2)',
    )
    expect(spec.notes).toContain('数据已经中心化，截距不进惩罚项。')
  })

  it('普通最小二乘干脆不画惩罚项', () => {
    const spec = pick(
      formulasOf('linear_regression', {
        blocks: [],
        ports,
        config: { regularization: 'none' },
      }),
      'fit',
    )

    expect(formulaText(spec.filled ?? [])).toContain('普通最小二乘')
    expect(spec.notes).toEqual([])
  })

  it('这次运行没记下正则化方式时不瞎猜成 0', () => {
    const spec = pick(
      formulasOf('linear_regression', { blocks: [], ports, config: {} }),
      'fit',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('正则化方式')
  })
})

describe('逻辑回归的公式', () => {
  const two = model({
    algo: 'logistic_regression',
    task: 'classification',
    classes: [0, 1],
  })
  const ports: PortPreview[] = [{ port: 'model', preview: two }]

  it('判别式代入系数，且默认就展开', () => {
    const spec = pick(
      formulasOf('logistic_regression', { blocks: [], ports, config: {} }),
      'score',
    )

    expect(formulaText(spec.filled ?? [])).toBe(
      'z = 1403.2 + 3.21*温度 - 0.84*负荷',
    )
    expect(spec.isOpen).toBe(true)
    expect(spec.notes[0]).toContain('sigmoid')
  })

  it('概率那条是纯口径说明：没有实参可代，也不该报「代不进」', () => {
    const spec = pick(
      formulasOf('logistic_regression', { blocks: [], ports, config: {} }),
      'probability',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toBeNull()
    expect(formulaText(spec.symbolic)).toBe('p(x) = (1) / (1 + exp(-z))')
  })

  it('判成哪一类：正类是后一个类目', () => {
    const spec = pick(
      formulasOf('logistic_regression', { blocks: [], ports, config: {} }),
      'decide',
    )

    expect(formulaText(spec.filled ?? [])).toBe(
      'y = { 1 若 p(x) >= 0.5; 0 若 p(x) < 0.5 }',
    )
    expect(spec.notes[0]).toContain('0.5')
  })

  // ⚠ 阈值升成超参之后照着「固定 0.5」讲的话，公式会与它自己的参数面板互相
  // 打脸，而两侧用例、typecheck 与 lint 全绿（§13.2）
  it('判正类的阈值照这一次配的那个印，不写死 0.5', () => {
    const spec = pick(
      formulasOf('logistic_regression', {
        blocks: [],
        ports,
        config: { positive_threshold: 0.7 },
      }),
      'decide',
    )

    expect(formulaText(spec.filled ?? [])).toBe(
      'y = { 1 若 p(x) >= 0.7; 0 若 p(x) < 0.7 }',
    )
    expect(spec.notes[0]).toContain('0.7')
    expect(spec.notes[0]).not.toContain('写死')
  })

  it('判别式那句提醒里的阈值也跟着配置走', () => {
    const spec = pick(
      formulasOf('logistic_regression', {
        blocks: [],
        ports,
        config: { positive_threshold: 0.7 },
      }),
      'score',
    )

    expect(spec.notes[0]).toContain('跟 0.7 比')
  })

  it('config 里读不出阈值时退回出厂值，与后端落在同一个数上', () => {
    const spec = pick(
      formulasOf('logistic_regression', { blocks: [], ports, config: {} }),
      'decide',
    )

    expect(formulaText(spec.filled ?? [])).toContain('p(x) >= 0.5')
  })

  it('摘要里没有类目时不硬编一个正类出来', () => {
    const blind = model({ classes: [] })
    const spec = pick(
      formulasOf('logistic_regression', {
        blocks: [],
        ports: [{ port: 'model', preview: blind }],
        config: {},
      }),
      'decide',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('没有类目')
  })

  it('几率比那条给的是业务读法', () => {
    const spec = pick(
      formulasOf('logistic_regression', { blocks: [], ports, config: {} }),
      'odds',
    )

    expect(formulaText(spec.symbolic)).toBe('(p) / (1 - p) = exp(z)')
  })
})

describe('训练测试切分的公式', () => {
  it('两段行数与配置比例一起代进去', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(800, 200),
        config: { test_ratio: 0.2, method: 'time_order' },
      }),
      'size',
    )

    expect(formulaText(spec.filled ?? [])).toBe(
      'n_test = min(max(floor(1000*0.2), 1), 999) = 200, n_train = 800',
    )
    expect(spec.notes).toEqual([])
  })

  it('配 5% 只有 10 行时实得 10%，必须当场说出来', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(9, 1),
        config: { test_ratio: 0.05 },
      }),
      'size',
    )

    expect(spec.notes[0]).toContain('配的是 5%')
    expect(spec.notes[0]).toContain('= 10%')
  })

  it('两路行数取不到时只出符号态', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: [],
        config: { test_ratio: 0.2 },
      }),
      'size',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('两路的行数')
  })

  it('一行都没有也不会除出个 NaN', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(0, 0),
        config: { test_ratio: 0.2 },
      }),
      'size',
    )

    expect(formulaText(spec.filled ?? [])).toContain('= 0, n_train = 0')
    expect(spec.notes[0]).toContain('= 0%')
  })

  it('随机切把泄漏警告写进式子里', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(800, 200),
        config: { method: 'random', random_state: 42 },
      }),
      'order',
    )

    expect(formulaText(spec.filled ?? [])).toContain(
      'pi({0, ..., 999}; 种子 42)',
    )
    expect(formulaText(spec.filled ?? [])).toContain('泄漏')
  })

  it('按时间切的测试段是最后那一截', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(800, 200),
        config: { method: 'time_order' },
      }),
      'order',
    )

    expect(formulaText(spec.filled ?? [])).toContain('{800, ..., 999}')
  })

  it('没记下切分方式时说的是「没记下方式」而不是「没有行数」', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(8, 2),
        config: {},
      }),
      'order',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('切分方式')
  })

  it('两路行数缺席时的措辞另算一档', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: [],
        config: { method: 'random' },
      }),
      'order',
    )

    expect(spec.fallback).toContain('两路的行数')
  })
})

describe('树回归的公式', () => {
  const tree = model({
    algo: 'tree_regressor',
    coefficients: [],
    intercept: null,
    servingChannel: 'binary',
  })
  const ports: PortPreview[] = [{ port: 'model', preview: tree }]

  it('通道 B 画不出系数是正常的，措辞要说清这一点', () => {
    const spec = pick(
      formulasOf('tree_regressor', {
        blocks: [],
        ports,
        config: { shape: 'forest' },
      }),
      'ensemble',
    )

    expect(spec.filled).toBeNull()
    expect(spec.fallback).toContain('二进制产物')
    expect(spec.fallback).toContain('这不是出错')
  })

  it('随机森林是一堆树取平均', () => {
    const spec = pick(
      formulasOf('tree_regressor', {
        blocks: [],
        ports,
        config: { shape: 'forest', n_estimators: 100 },
      }),
      'ensemble',
    )

    expect(formulaText(spec.symbolic)).toBe(
      'y(x) = (1) / (M)*sum(m = 1..M, Tm(x))',
    )
    expect(spec.notes).toContain('这次配的是 M = 100 棵树。')
  })

  it('梯度提升换一副骨架，并交代改不了的学习率', () => {
    const spec = pick(
      formulasOf('tree_regressor', {
        blocks: [],
        ports,
        config: { shape: 'gbdt' },
      }),
      'ensemble',
    )

    expect(formulaText(spec.symbolic)).toBe(
      'y(x) = F0 + nu*sum(m = 1..M, hm(x))',
    )
    expect(spec.notes.some((note) => note.includes('nu = 0.1'))).toBe(false)
    expect(spec.notes.some((note) => note.includes('ν = 0.1'))).toBe(true)
  })

  it('不外推这条坑两种形态都要说', () => {
    for (const shape of ['forest', 'gbdt']) {
      const spec = pick(
        formulasOf('tree_regressor', { blocks: [], ports, config: { shape } }),
        'ensemble',
      )

      expect(spec.notes[0]).toContain('不外推')
    }
  })

  it('分裂准则是纯口径说明，两个分式都在', () => {
    const spec = pick(
      formulasOf('tree_regressor', { blocks: [], ports, config: {} }),
      'split',
    )

    expect(spec.fallback).toBeNull()
    expect(formulaText(spec.symbolic)).toBe(
      'delta = Var(S) - (|S_L|) / (|S|)*Var(S_L) - (|S_R|) / (|S|)*Var(S_R)',
    )
  })
})

describe('骨架表的边界', () => {
  // ⚠ 认不出的 code 给空清单而不是抛错：结果面上那一步只是不摆 ④ 区，
  // 不会连着把整个弹窗一起炸掉
  it('没登记的算子给空清单，不是抛错', () => {
    expect(
      formulasOf('将来某个算子', { blocks: [], ports: [], config: {} }),
    ).toEqual([])
  })

  it('24 个算子逐个都登记了', () => {
    expect(formulaCodes()).toHaveLength(24)
    for (const code of [
      'split_dataset',
      'linear_regression',
      'logistic_regression',
      'tree_regressor',
      'cast_type',
      'ledger_source',
      'cross_validate',
    ]) {
      expect(
        formulasOf(code, { blocks: [], ports: [], config: {} }).length,
        code,
      ).toBeGreaterThan(0)
    }
  })

  it('警示项是有的，颜色之外还得有第二重编码', () => {
    const spec = pick(
      formulasOf('split_dataset', {
        blocks: [],
        ports: split(8, 2),
        config: { method: 'random' },
      }),
      'order',
    )
    const terms = (spec.filled ?? []).flatMap((node) =>
      node.node === 'run' ? node.terms : [],
    )

    expect(terms.some((term) => term.kind === 'warn')).toBe(true)
    expect(warnOf('x').kind).toBe('warn')
  })
})
