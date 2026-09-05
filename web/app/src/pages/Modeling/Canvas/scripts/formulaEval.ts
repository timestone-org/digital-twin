/**
 * @fileoverview 评估这五个算子的公式骨架（规格 §5 的 20–24 条）。
 *
 * ⚠ 分母为 0 的指标是**无定义**，不是 0：把公式与那个「无定义」摆在一起，用户
 * 自己就看得出是哪一种分母为 0（没判过正类 / 判成正类的全错）。这几条因此在
 * 指标读不出来时**自动展开**（规格 §6）。
 */
import { frac, nameOf, numOf, opOf, run, sqrt, sum, varOf } from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import {
  NO_BLOCK,
  blockAt,
  breakdownItems,
  itemAt,
  numberAt,
  numberIn,
  textAt,
} from './formulaArgs'
import { niceNumber } from './numbers'

/** 指标那一块的标题，逐字与后端 `evalblocks` 对齐。 */
const METRIC_TITLES = {
  regression: '回归指标',
  classification: '分类指标',
  residual: '残差统计量',
  folds: '逐折分数',
} as const

/** 一块指标里某一项的值；读不出来是 null（不是 0）。 */
function metricAt(context: FormulaContext, title: string, key: string) {
  const items = breakdownItems(blockAt(context.blocks, 'breakdown', title))
  const found = itemAt(items, key)
  return found === null ? null : numberIn(found, 'value')
}

function r2Formula(context: FormulaContext): FormulaSpec {
  const value = metricAt(context, METRIC_TITLES.regression, 'r2')
  return {
    id: 'r2',
    title: 'R² 是怎么算的',
    symbolic: [
      run(varOf('R²'), opOf('='), varOf('1'), opOf('−')),
      frac([run(varOf('Σ e_i²'))], [run(varOf('Σ (y_i − ȳ)²'))]),
    ],
    filled: value === null ? null : [run(varOf('R²'), opOf('='), numOf(value))],
    // ⚠ 算不出来的时候才是最需要读公式的时候：分母是真值本身的方差，一列常数
    // 的方差是 0，除法做不了，所以是无定义而不是 0 分
    fallback:
      value === null
        ? '这一屏没有 R²：真值那一列如果是一列常数，分母就是 0，这个数无定义'
        : null,
    isOpen: value === null,
    legend: [
      { symbol: 'e_i', text: '第 i 行的残差 = 真值 − 预测值' },
      { symbol: 'ȳ', text: '真值这一列的均值' },
    ],
    notes: ['分母是真值自己的方差：真值几乎不变的那种数据上，R² 会非常难看。'],
  }
}

function errorFormulas(context: FormulaContext): FormulaSpec {
  const mape = metricAt(context, METRIC_TITLES.regression, 'mape')
  const rmse = metricAt(context, METRIC_TITLES.regression, 'rmse')
  return {
    id: 'errors',
    title: 'RMSE / MAE / MAPE 各是什么',
    symbolic: [
      run(nameOf('RMSE'), opOf('=')),
      sqrt([frac([run(varOf('Σ e_i²'))], [run(varOf('n'))])]),
      run(opOf(','), nameOf('MAE'), opOf('=')),
      frac([run(varOf('Σ |e_i|'))], [run(varOf('n'))]),
      run(opOf(','), nameOf('MAPE'), opOf('=')),
      frac([run(varOf('100 · Σ_{i∈Z} |e_i| / |y_i|'))], [run(varOf('|Z|'))]),
    ],
    filled:
      rmse === null
        ? null
        : [
            run(nameOf('RMSE'), opOf('='), numOf(rmse)),
            ...(mape === null
              ? []
              : [run(opOf(','), nameOf('MAPE'), opOf('='), numOf(mape), nameOf('%'))]),
          ],
    fallback:
      mape === null && rmse !== null
        ? 'MAPE 这一屏没有：真值等于 0 的那些行进不了它的分母，一行都不剩时这个数无定义'
        : rmse === null
          ? NO_BLOCK
          : null,
    isOpen: mape === null,
    legend: [
      { symbol: 'n', text: '参与评估的行数' },
      { symbol: 'Z', text: '真值不为 0 的那些行——只有它们进 MAPE 的分母' },
    ],
    notes: [
      'RMSE 与 MAE 都带着目标列的量纲：0.5 是好是坏取决于这一列本身多大，没有公认的好坏线。',
    ],
  }
}

function confusionFormula(context: FormulaContext): FormulaSpec {
  const precision = metricAt(context, METRIC_TITLES.classification, 'precision')
  const recall = metricAt(context, METRIC_TITLES.classification, 'recall')
  const label = numberAt(context.config, 'positive_label')
  const blind = precision === null || recall === null
  return {
    id: 'confusion',
    title: '精确率与召回率是从矩阵哪几格来的',
    symbolic: [
      run(nameOf('P'), opOf('=')),
      frac([run(varOf('TP'))], [run(varOf('TP + FP'))]),
      run(opOf(','), nameOf('R'), opOf('=')),
      frac([run(varOf('TP'))], [run(varOf('TP + FN'))]),
      run(opOf(','), nameOf('F₁'), opOf('=')),
      frac([run(varOf('2PR'))], [run(varOf('P + R'))]),
    ],
    filled: blind
      ? null
      : [
          run(nameOf('P'), opOf('='), numOf(precision), opOf(','), nameOf('R'), opOf('='), numOf(recall)),
        ],
    // ⚠ 两种分母为 0 要分得开：一次都没判成正类（P 的分母为 0）与正类一次都
    // 没出现过（R 的分母为 0），前者调阈值、后者换测试集
    fallback: blind
      ? '这一屏有指标是无定义的：一次都没判成正类时精确率的分母是 0，正类在这份测试集里一次都没出现时召回率的分母是 0'
      : null,
    isOpen: blind,
    legend: [
      { symbol: 'TP', text: `真的是正类${label === null ? '' : `「${niceNumber(label)}」`}、也判成了正类的行数` },
      { symbol: 'FP', text: '不是正类却判成了正类' },
      { symbol: 'FN', text: '是正类却没判出来' },
    ],
    notes: [
      '矩阵的行是真值、列是预测：对角线是判对的那几格。',
      '类目名单只从这份测试集里取——正类一次都没出现过时，矩阵里根本没有那一行。',
    ],
  }
}

function residualStats(context: FormulaContext): FormulaSpec {
  const mean = metricAt(context, METRIC_TITLES.residual, 'residual_mean')
  const std = metricAt(context, METRIC_TITLES.residual, 'residual_std')
  return {
    id: 'spread',
    title: '偏均值与离散度',
    symbolic: [
      run(varOf('ē'), opOf('=')),
      frac([run(varOf('Σ e_i'))], [run(varOf('n'))]),
      run(opOf(','), varOf('s_e'), opOf('=')),
      sqrt([frac([run(varOf('Σ (e_i − ē)²'))], [run(varOf('n'))])]),
    ],
    filled:
      mean === null || std === null
        ? null
        : [run(varOf('ē'), opOf('='), numOf(mean), opOf(','), varOf('s_e'), opOf('='), numOf(std))],
    fallback: mean === null || std === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'ē', text: '残差的均值：整体偏高还是偏低' },
      { symbol: 's_e', text: '残差的离散度（总体口径，除 n）' },
    ],
    notes: [
      '⚠ 总体口径除的是 n：Excel 的 STDEV 除的是 n−1，两边核对不上是这个原因。',
      '分位数走有序残差上的线性插值：t = q(n−1)，落在两个数中间时按小数位往上凑。',
    ],
  }
}

function permutationFormula(context: FormulaContext): FormulaSpec {
  const repeats = numberAt(context.config, 'repeats')
  const base = blockAt(context.blocks, 'breakdown', '打乱前的基线分')
  const baseline = base === null ? null : numberIn(base.payload, 'baseline')
  return {
    id: 'permutation',
    title: '重要性是怎么打出来的',
    symbolic: [
      run(varOf('I_j'), opOf('=')),
      frac([run(varOf('1'))], [run(varOf('R'))]),
      run(opOf('·')),
      sum('r = 1', 'R', [run(varOf('[ s(y, f(X)) − s(y, f(X^π)) ]'))]),
    ],
    filled:
      baseline === null
        ? null
        : [
            run(
              varOf('s(y, f(X))'),
              opOf('='),
              numOf(baseline),
              ...(repeats === null
                ? []
                : [opOf(','), varOf('R'), opOf('='), numOf(repeats)]),
            ),
          ],
    fallback: baseline === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'R', text: '每一列打乱几遍' },
      { symbol: 'X^π', text: '只把第 j 列按随机种子重排之后的那份数据' },
      { symbol: 's', text: '打分口径：回归是 R²、分类是准确率' },
    ],
    notes: [
      'I_j ≤ 0 表示打乱这一列反而没变差——这是一列噪声，可以直接删掉。',
      '⚠ 同一个 0.12：基线 R²=0.9 时是砍掉 13% 的解释力，基线 0.2 时是砍掉 60%。离开基线读不出轻重。',
    ],
  }
}

function foldFormula(context: FormulaContext): FormulaSpec {
  const method = textAt(context.config, 'method')
  const configured = numberAt(context.config, 'folds')
  const isChain = method !== 'kfold'
  const rows = blockAt(context.blocks, 'rows')
  const got = rows === null ? null : foldCount(rows.payload)
  return {
    id: 'folds',
    title: isChain ? '前向链是怎么切的' : 'K 折是怎么切的',
    symbolic: [
      run(varOf('w'), opOf('='), varOf('⌊N / K⌋'), opOf(','), varOf('T_k'), opOf('='), varOf('[kw, (k+1)w)')),
      run(
        opOf(','),
        varOf('Tr_k'),
        opOf('='),
        varOf(isChain ? '[0, kw)' : '全部行 \\ T_k'),
      ),
    ],
    filled:
      configured === null || got === null
        ? null
        : [
            run(
              varOf('K'),
              opOf('='),
              numOf(configured),
              opOf(','),
              varOf('实得'),
              opOf('='),
              numOf(got),
              nameOf(isChain ? '折（第一折没有可训的行，整折丢弃）' : '折'),
            ),
          ],
    fallback: configured === null || got === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'N', text: '总行数' },
      { symbol: 'w', text: '每折的测试行数，末折吃余数' },
      { symbol: 'T_k / Tr_k', text: '第 k 折的测试段与训练段' },
    ],
    notes: [
      isChain
        ? '前向链只拿测试段**之前**的行训练：所以实得折数比配置少一折。'
        : '⚠ K 折会拿未来的行去训过去的折：时序数据上这样评出来的分偏高。',
      '稳定性看 σ / |均值|：σ = 0.03 是好是坏取决于均值多大。',
    ],
  }
}

/** 「实得折数」那一级：漏斗里按名字找，找不到给 null。 */
function foldCount(payload: Record<string, unknown>): number | null {
  const funnel = payload['funnel']
  if (!Array.isArray(funnel)) return null
  for (const one of funnel) {
    if (typeof one !== 'object' || one === null) continue
    const item = one as Record<string, unknown>
    if (item['name'] === '实得折数') return numberIn(item, 'value')
  }
  return null
}

export const EVAL_FORMULAS = {
  regression_metrics: [r2Formula, errorFormulas],
  classification_metrics: [confusionFormula],
  residual_analysis: [residualStats],
  feature_importance: [permutationFormula],
  cross_validate: [foldFormula],
} as const
