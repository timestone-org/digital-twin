/**
 * @fileoverview 建模算子的公式骨架表，按算子 code 建键。24 个算子一个不漏。
 *
 * 骨架随算子代码走、不随运行走——公式**不进结果摘要**（§6）：放进去等于每次
 * 运行把同一串常量重传一遍还要吃字节预算。实参只从三处取：这一步的讲解块、
 * 逐路摘要里的系数与类目，以及运行时冻结下来的节点 config 快照（所以
 * `test_ratio` 这些「参数不进摘要」的量零后端解决，历史回看也正确）。
 *
 * ⚠ 后端算子花名册里的每个 code 在这张表里都要有，由
 * `tests/contract/modeling-formulas.contract.spec.ts` 单向钉住；反向允许多，
 * 前端可以先给将来的算子备好骨架。
 * ⚠ 默认展开只有六处（§6）：有实参且实参就是结论的那几条。纯口径说明一律折起
 * 来，但指标为 null 时那一条自动展开——那时它正好回答「为什么是无定义」。
 */
import type { FormulaNode, FormulaTerm } from './formula'
import {
  cases,
  frac,
  nameOf,
  numOf,
  opOf,
  run,
  sum,
  varOf,
  warnOf,
} from './formula'
import type {
  FormulaContext,
  FormulaLegend,
  FormulaMaker,
  FormulaSpec,
} from './formulaArgs'
import {
  frameAt,
  modelAt,
  numberAt,
  percent,
  textAt,
} from './formulaArgs'
import { CLEAN_FORMULAS } from './formulaClean'
import { EVAL_FORMULAS } from './formulaEval'
import { FEATURE_FORMULAS } from './formulaFeature'
import { niceNumber } from './numbers'
import type { ModelPreview } from './preview'

export type { FormulaContext, FormulaLegend, FormulaSpec }

// 实得比例与配置比例差到这个数才值得说一句
const RATIO_GAP = 0.005

/**
 * 代不进系数时那句话。四种「没有」措辞各不相同，合并了就分不清是哪一种。
 * Args: model。
 */
function coefFallback(model: ModelPreview | null): string {
  if (model === null) return '这一步的结果摘要里没有模型，代不进实参'
  if (model.servingChannel === 'binary') {
    return '树模型的拟合结果存成一份二进制产物，公式里代不进系数——这不是出错'
  }
  if (model.isFittedTrimmed) {
    return '这一步的结果摘要太大，系数没有一起带回来；模型本身是训好的'
  }
  return '这个模型没有可读的系数'
}

/**
 * 系数项。⚠ 负号拆出来当运算符：连着写会印成「+ −0.84」。
 * Args: model, isHead——第一项前面要不要省掉加号。
 */
function weightTerms(model: ModelPreview, isHead: boolean): FormulaTerm[] {
  const terms: FormulaTerm[] = []
  for (const [key, weight] of model.coefficients) {
    const first = isHead && terms.length === 0
    if (first) {
      if (weight < 0) terms.push(opOf('−'))
    } else {
      terms.push(opOf(weight < 0 ? '−' : '+'))
    }
    terms.push(numOf(Math.abs(weight)), opOf('·'), varOf(key))
  }
  return terms
}

/**
 * 代入了系数的那一行。截距缺席时第一项顶上来。
 * Args: model, head——等号左边那个符号。
 */
function fittedRun(model: ModelPreview, head: FormulaTerm): FormulaNode {
  const intercept = model.intercept
  const lead = intercept === null ? [] : [numOf(intercept)]
  return run(
    head,
    opOf('='),
    ...lead,
    ...weightTerms(model, intercept === null),
  )
}

/**
 * 线性判别式：符号态 + 代入态。线性回归与逻辑回归共用一份。
 * Args: context, id, title, head, notes。
 */
function linearShape(
  context: FormulaContext,
  id: string,
  title: string,
  head: FormulaTerm,
  notes: string[],
): FormulaSpec {
  const model = modelAt(context.ports)
  const hasCoef = model !== null && model.coefficients.length > 0
  return {
    id,
    title,
    symbolic: [
      run(head, opOf('='), varOf('β₀'), opOf('+')),
      sum('j = 1', 'p', [run(varOf('βⱼ'), opOf('·'), varOf('xⱼ'))]),
    ],
    filled: hasCoef ? [fittedRun(model, head)] : null,
    fallback: hasCoef ? null : coefFallback(model),
    isOpen: true,
    legend: [
      { symbol: head.text, text: title },
      { symbol: 'β₀', text: '截距' },
      { symbol: 'βⱼ', text: '第 j 个特征列的系数' },
      { symbol: 'xⱼ', text: '第 j 个特征列这一行的值' },
      { symbol: 'p', text: '特征列的个数' },
    ],
    notes,
  }
}

function linearPredict(context: FormulaContext): FormulaSpec {
  return linearShape(context, 'predict', '预测值', nameOf('ŷ'), [
    '系数的大小跟着各列的量纲走：上游没做标准化时，单位小的列天然拿到大系数，按 |β| 排出来的先后不是重要性。',
  ])
}

function linearFit(context: FormulaContext): FormulaSpec {
  const kind = textAt(context.config, 'regularization')
  const alpha =
    kind === 'none'
      ? 0
      : kind === 'ridge'
        ? numberAt(context.config, 'ridge_alpha')
        : null
  const head = [
    run(varOf('β'), opOf('='), nameOf('argmin')),
    sum('i = 1', 'n', [run(varOf('eᵢ²'))]),
  ]
  const penalty: FormulaNode[] =
    alpha === null || alpha === 0
      ? [run(nameOf('（普通最小二乘，没有惩罚项）'))]
      : [run(opOf('+'), numOf(alpha)), sum('j = 1', 'p', [run(varOf('βⱼ²'))])]
  return {
    id: 'fit',
    title: '系数是怎么解出来的',
    symbolic: [
      ...head,
      run(opOf('+'), varOf('α')),
      sum('j = 1', 'p', [run(varOf('βⱼ²'))]),
    ],
    filled: alpha === null ? null : [...head, ...penalty],
    fallback: alpha === null ? '这次运行没有记下正则化方式，代不进 α' : null,
    isOpen: false,
    legend: [
      { symbol: 'eᵢ', text: '第 i 行的残差 yᵢ − β₀ − Σ βⱼ·xᵢⱼ' },
      { symbol: 'α', text: '岭回归的惩罚强度，普通最小二乘是 0' },
      { symbol: 'n', text: '训练集行数' },
    ],
    notes:
      alpha !== null && alpha > 0 ? ['数据已经中心化，截距不进惩罚项。'] : [],
  }
}

/** 切出来的两段与配置比例。⚠ 一行都没有时不去做那次除法。 */
function splitFilled(
  train: number,
  test: number,
  ratio: number,
): { nodes: FormulaNode[]; notes: string[] } {
  const total = train + test
  const taken = `min(max(⌊${niceNumber(total)}·${niceNumber(ratio)}⌋, 1), ${niceNumber(total - 1)})`
  const actual = total === 0 ? 0 : test / total
  const nodes = [
    run(
      varOf('n_test'),
      opOf('='),
      varOf(taken),
      opOf('='),
      numOf(test),
      opOf(','),
      varOf('n_train'),
      opOf('='),
      numOf(train),
    ),
  ]
  if (Math.abs(actual - ratio) < RATIO_GAP) return { nodes, notes: [] }
  return {
    nodes,
    notes: [
      `配的是 ${percent(ratio)}，一共 ${niceNumber(total)} 行；向下取整再夹到至少 1 行之后实际切出 ${niceNumber(test)} 行 = ${percent(actual)}。`,
    ],
  }
}

function splitSize(context: FormulaContext): FormulaSpec {
  const ratio = numberAt(context.config, 'test_ratio')
  const train = frameAt(context.ports, 'train')
  const test = frameAt(context.ports, 'test')
  const body =
    train === null || test === null || ratio === null
      ? null
      : splitFilled(train.rowCount, test.rowCount, ratio)
  return {
    id: 'size',
    title: '两段各多少行',
    symbolic: [
      run(
        varOf('n_test'),
        opOf('='),
        varOf('min(max(⌊N·r⌋, 1), N − 1)'),
        opOf(','),
        varOf('n_train'),
        opOf('='),
        varOf('N − n_test'),
      ),
    ],
    filled: body?.nodes ?? null,
    fallback:
      body === null ? '这一步的结果摘要里没有两路的行数，代不进实参' : null,
    isOpen: true,
    legend: [
      { symbol: 'N', text: '切分前的总行数' },
      { symbol: 'r', text: '配置里的测试集比例' },
    ],
    notes: body?.notes ?? [],
  }
}

/** 按切分方式代出测试集那批下标。认不出方式时给 null。 */
function orderFilled(
  method: string,
  seed: number | null,
  train: number,
  test: number,
): FormulaNode[] | null {
  const total = train + test
  if (method === 'time_order') {
    return [
      run(
        varOf('I_test'),
        opOf('='),
        varOf(`{${niceNumber(train)}, …, ${niceNumber(total - 1)}}`),
        nameOf('测试段就是时间上最后的那一截'),
      ),
    ]
  }
  if (method !== 'random') return null
  const label = seed === null ? '' : `; 种子 ${niceNumber(seed)}`
  return [
    run(
      varOf('I_test'),
      opOf('='),
      varOf(
        `π({0, …, ${niceNumber(total - 1)}}${label}) 的最后 ${niceNumber(test)} 个`,
      ),
      warnOf('随机切会把未来的数据泄漏进训练集'),
    ),
  ]
}

function splitOrder(context: FormulaContext): FormulaSpec {
  const train = frameAt(context.ports, 'train')
  const test = frameAt(context.ports, 'test')
  const blind = train === null || test === null
  const filled = blind
    ? null
    : orderFilled(
        textAt(context.config, 'method'),
        numberAt(context.config, 'random_state'),
        train.rowCount,
        test.rowCount,
      )
  return {
    id: 'order',
    title: '哪些行进了测试集',
    symbolic: [
      run(varOf('I_test'), opOf('=')),
      cases([
        {
          when: 'method = time_order',
          then: [run(varOf('{N − n_test, …, N − 1}'))],
        },
        {
          when: 'method = random',
          then: [run(varOf('π({0, …, N − 1}) 的最后 n_test 个'))],
        },
      ]),
    ],
    filled,
    fallback: blind
      ? '这一步的结果摘要里没有两路的行数，代不进实参'
      : filled === null
        ? '这次运行没有记下切分方式，代不进实参'
        : null,
    isOpen: false,
    legend: [
      { symbol: 'I_test', text: '进了测试集的那些行的下标' },
      { symbol: 'π', text: '按随机种子生成的一个全排列' },
    ],
    notes: [],
  }
}

function logitScore(context: FormulaContext): FormulaSpec {
  return linearShape(context, 'score', '判别式 z', varOf('z'), [
    '⚠ z 还要过一层 sigmoid 再跟 0.5 比，别把这些系数当线性回归的系数直接读。',
  ])
}

function logitProbability(): FormulaSpec {
  return {
    id: 'probability',
    title: '判别式怎么变成概率',
    symbolic: [
      run(varOf('p(x)'), opOf('=')),
      frac([run(varOf('1'))], [run(varOf('1'), opOf('+'), varOf('exp(−z)'))]),
    ],
    filled: null,
    fallback: null,
    isOpen: false,
    legend: [{ symbol: 'p(x)', text: '这一行落在正类上的概率' }],
    notes: [
      'z 先夹到 [−700, 700] 再取指数：特征没标准化时线性部分轻易越过 exp 的溢出线。',
    ],
  }
}

function logitDecide(context: FormulaContext): FormulaSpec {
  const model = modelAt(context.ports)
  const [low, high] = model?.classes ?? []
  const known = low !== undefined && high !== undefined
  const rule = (small: FormulaTerm, large: FormulaTerm): FormulaNode[] => [
    run(nameOf('ŷ'), opOf('=')),
    cases([
      { when: 'p(x) ≥ 0.5', then: [run(large)] },
      { when: 'p(x) < 0.5', then: [run(small)] },
    ]),
  ]
  return {
    id: 'decide',
    title: '判成哪一类',
    symbolic: rule(varOf('c₀'), varOf('c₁')),
    filled: known ? rule(numOf(low), numOf(high)) : null,
    fallback: known ? null : '这一步的结果摘要里没有类目，看不出哪一类算正类',
    isOpen: false,
    legend: [{ symbol: 'c₀ / c₁', text: '目标列的两个类目，升序；c₁ 是正类' }],
    notes: [
      '阈值 0.5 是写死在算子里的常量，既不是超参也不进结果摘要：类目不平衡时它调不了也看不见。',
      'penalty 与 solver 用的是 sklearn 的默认值，本仓只传了截距开关与 C。',
    ],
  }
}

function logitOdds(): FormulaSpec {
  return {
    id: 'odds',
    title: '读成几率比',
    symbolic: [
      frac([run(varOf('p'))], [run(varOf('1'), opOf('−'), varOf('p'))]),
      run(opOf('='), varOf('exp(z)')),
    ],
    filled: null,
    fallback: null,
    isOpen: false,
    legend: [{ symbol: 'p / (1 − p)', text: '出事与不出事的几率之比' }],
    notes: [
      '某一列每加 1 个单位，出事的几率乘 exp(βⱼ) 倍——这是逻辑回归唯一能直接讲给业务听的读法。',
    ],
  }
}

function treeEnsemble(context: FormulaContext): FormulaSpec {
  const shape = textAt(context.config, 'shape')
  const trees = numberAt(context.config, 'n_estimators')
  const isBoost = shape === 'gbdt'
  const notes = [
    '⚠ 两种都是分段常数：x 落在训练区间之外时，预测值恒等于边界那片叶子的值——树不外推。',
  ]
  if (isBoost) {
    notes.push(
      '学习率 ν = 0.1 是 sklearn 的默认值，本仓没把它做成参数：你改不了也看不见。',
    )
  }
  if (trees !== null) notes.push(`这次配的是 M = ${niceNumber(trees)} 棵树。`)
  return {
    id: 'ensemble',
    title: isBoost ? '梯度提升怎么给出预测值' : '随机森林怎么给出预测值',
    symbolic: isBoost
      ? [
          run(
            nameOf('ŷ(x)'),
            opOf('='),
            varOf('F₀'),
            opOf('+'),
            varOf('ν'),
            opOf('·'),
          ),
          sum('m = 1', 'M', [run(varOf('hₘ(x)'))]),
        ]
      : [
          run(nameOf('ŷ(x)'), opOf('=')),
          frac([run(varOf('1'))], [run(varOf('M'))]),
          run(opOf('·')),
          sum('m = 1', 'M', [run(varOf('Tₘ(x)'))]),
        ],
    filled: null,
    fallback: coefFallback(modelAt(context.ports)),
    isOpen: false,
    legend: [
      { symbol: 'M', text: '树的棵数' },
      { symbol: isBoost ? 'hₘ' : 'Tₘ', text: '第 m 棵树' },
      ...(isBoost
        ? [{ symbol: 'F₀', text: '起点，取训练集目标列的均值' }]
        : []),
    ],
    notes,
  }
}

function treeSplit(): FormulaSpec {
  return {
    id: 'split',
    title: '每一刀切在哪',
    symbolic: [
      run(varOf('Δ'), opOf('='), varOf('Var(S)'), opOf('−')),
      frac([run(varOf('|S_L|'))], [run(varOf('|S|'))]),
      run(opOf('·'), varOf('Var(S_L)'), opOf('−')),
      frac([run(varOf('|S_R|'))], [run(varOf('|S|'))]),
      run(opOf('·'), varOf('Var(S_R)')),
    ],
    filled: null,
    fallback: null,
    isOpen: false,
    legend: [
      { symbol: 'S', text: '落在这个节点上的那批行' },
      { symbol: 'S_L / S_R', text: '切开之后落到左右两边的行' },
    ],
    notes: ['每一刀都挑让 Δ 最大的那个切分点。'],
  }
}

const CATALOG: Record<string, readonly FormulaMaker[]> = {
  ...CLEAN_FORMULAS,
  ...FEATURE_FORMULAS,
  ...EVAL_FORMULAS,
  split_dataset: [splitSize, splitOrder],
  linear_regression: [linearPredict, linearFit],
  logistic_regression: [logitScore, logitProbability, logitDecide, logitOdds],
  tree_regressor: [treeEnsemble, treeSplit],
}

/** 后端花名册里的每个 code 在这里都有；契约用例遍历的就是这份键集。 */
export function formulaCodes(): string[] {
  return Object.keys(CATALOG).sort()
}

/**
 * 一个算子的公式清单。没登记的算子给空数组，界面上就是不摆 ④ 区。
 * Args: code, context。
 */
export function formulasOf(
  code: string,
  context: FormulaContext,
): FormulaSpec[] {
  return (CATALOG[code] ?? []).map((make) => make(context))
}
