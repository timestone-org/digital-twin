/**
 * @fileoverview 造特征这七个算子的公式骨架（规格 §5 的 9–15 条）。
 *
 * ⚠ 标准差一律是**总体口径**（除 n，不是 n−1）：写不写出来决定了用户拿 Excel
 * 的 STDEV 核对时对不对得上——两家默认口径正好相反。
 * ⚠ 滞后与滚动按**行序**而不是按时刻走：中间插了一步改行序的算子，这两个算子
 * 会整片错，而图上的校验也拦不住。
 */
import type { FormulaNode } from './formula'
import {
  cases,
  frac,
  nameOf,
  numOf,
  opOf,
  run,
  sqrt,
  sum,
  varOf,
  warnOf,
} from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import {
  NO_BLOCK,
  NO_CONFIG,
  blockAt,
  breakdownItems,
  firstParams,
  fitParamsOf,
  numberAt,
  numberIn,
  numbersAt,
  textsAt,
  textAt,
} from './formulaArgs'
import { niceNumber } from './numbers'
import { recordOf } from './reportBlocks'

/** 载荷项里最多摊开这么多列，再多公式会横过一屏。 */
const MAX_TERMS = 6

/**
 * 代入了中心与跨度的那一行。⚠ 跨度为 0 时不画那条分式：除数是 0 的式子印出来
 * 比不印更糟。
 * Args: head——列名与它那份拟合参数。
 */
function scaleLine(head: [string, Record<string, unknown>] | null) {
  if (head === null) return null
  const center = numberIn(head[1], 'center')
  const scale = numberIn(head[1], 'scale')
  if (center === null || scale === null || scale === 0) return null
  return [
    run(varOf(`z(${head[0]})`), opOf('=')),
    frac([run(varOf(head[0]), opOf('−'), numOf(center))], [run(numOf(scale))]),
  ]
}

function standardScale(context: FormulaContext): FormulaSpec {
  const head = firstParams(fitParamsOf(blockAt(context.blocks, 'fits')))
  const method = textAt(context.config, 'method')
  const isZ = method !== 'minmax'
  return {
    id: 'scale',
    title: isZ ? '每个数怎么缩成 z' : '每个数怎么缩到 0–1',
    symbolic: [
      run(varOf('z_j'), opOf('=')),
      frac(
        [run(varOf(isZ ? 'x_j − μ_j' : 'x_j − min_j'))],
        [run(varOf(isZ ? 'σ_j' : 'max_j − min_j'))],
      ),
    ],
    filled: scaleLine(head),
    fallback: head === null ? NO_BLOCK : null,
    isOpen: true,
    legend: isZ
      ? [
          { symbol: 'μ_j', text: '这一列在训练行上的均值' },
          { symbol: 'σ_j', text: '训练行上的标准差（总体口径，除 n）' },
        ]
      : [{ symbol: 'min_j / max_j', text: '这一列在训练行上的最小值与最大值' }],
    notes: [
      '⚠ 界面上这一列的均值不会正好是 0：μ 只在**训练行**上学，而列统计是在整帧上算的。这不是「标准化没生效」。',
    ],
  }
}

function oneHotRule(context: FormulaContext): FormulaSpec {
  const items = breakdownItems(blockAt(context.blocks, 'breakdown'))
  const names = items
    .map((one) => one['name'])
    .filter((one): one is string => typeof one === 'string')
    .slice(0, MAX_TERMS)
  const cap = numberAt(context.config, 'max_categories')
  return {
    id: 'encode',
    title: '一个类目变成哪一列',
    symbolic: [
      run(
        varOf('e_{j,c}(x)'),
        opOf('='),
        varOf('1[x = c]'),
        nameOf('，列名 = key=c'),
      ),
    ],
    filled:
      names.length === 0
        ? null
        : [run(nameOf('这一步造出'), ...names.map((one) => varOf(one)))],
    fallback: names.length === 0 ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      {
        symbol: 'C_j',
        text: `保留下来的类目，按 (命中行数降序, 字典序) 排${cap === null ? '' : `，最多 ${niceNumber(cap)} 个`}`,
      },
      { symbol: '1[·]', text: '成立记 1，不成立记 0' },
    ],
    notes: [
      '⚠ 没见过的类目不报错，整排编成全零；本来就是空的那一格也是全零——两种在编码之后长得一模一样，要调的东西却不同。',
    ],
  }
}

function selectScore(context: FormulaContext): FormulaSpec {
  const method = textAt(context.config, 'method')
  const topK = numberAt(context.config, 'top_k')
  const items = breakdownItems(blockAt(context.blocks, 'breakdown'))
  const isVariance = method !== 'correlation'
  const cut = items.length === 0 ? null : cutLine(items, topK)
  return {
    id: 'score',
    title: isVariance ? '方差怎么打分' : '相关系数怎么打分',
    symbolic: isVariance
      ? [
          run(varOf('s_j'), opOf('=')),
          frac([run(varOf('Σ(x_ij − x̄_j)²'))], [run(varOf('n'))]),
        ]
      : [
          run(varOf('s_j'), opOf('=')),
          frac(
            [run(varOf('|Σ(x − x̄)(y − ȳ)|'))],
            [run(varOf('√(Σ(x − x̄)² · Σ(y − ȳ)²)'))],
          ),
        ],
    filled: cut,
    fallback: cut === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 's_j', text: '第 j 列的分' },
      {
        symbol: 'k',
        text: `留下前几名 top_k${topK === null ? '' : ` = ${niceNumber(topK)}`}`,
      },
    ],
    notes: [
      isVariance
        ? '⚠ 方差跟着量纲走：单位大的列天然分高。上游没做标准化时，这份排名读的其实是「谁的单位大」。'
        : '只取两边都非空的行算相关系数：空得多的列，分是在很少几行上算出来的。',
      '按 (分数降序, 列名) 排，前 k 名留下。',
    ],
  }
}

/** 第 k 名与第 k+1 名之间那条线：分数断层在哪比排名本身更能指导调参。 */
function cutLine(
  items: readonly Record<string, unknown>[],
  topK: number | null,
): FormulaNode[] | null {
  const kept = items.filter((one) => one['kept'] === true)
  const head = kept[kept.length - 1]
  const next = items[kept.length]
  if (head === undefined) return null
  const line = [
    varOf(`第 ${niceNumber(topK ?? kept.length)} 名`),
    opOf('='),
    numOf(numberIn(head, 'value') ?? 0),
  ]
  if (next === undefined) return [run(...line, nameOf('，后面没有别的列了'))]
  return [
    run(...line),
    run(
      opOf(','),
      varOf('下一名'),
      opOf('='),
      numOf(numberIn(next, 'value') ?? 0),
    ),
  ]
}

function pcaTerms(context: FormulaContext): FormulaSpec {
  const items = fitParamsOf(blockAt(context.blocks, 'fits'))
  const head = firstParams(items)
  const filled = head === null ? null : pcTerms(head[0], head[1])
  return {
    id: 'component',
    title: '一条主成分是怎么加出来的',
    symbolic: [
      run(varOf('z_k'), opOf('=')),
      sum('j = 1', 'J', [run(varOf('w_kj'), opOf('·'), varOf('(x_j − μ_j)'))]),
    ],
    filled,
    fallback: filled === null ? NO_BLOCK : null,
    isOpen: true,
    legend: [
      { symbol: 'w_kj', text: '载荷：第 k 条主成分给第 j 列的权重' },
      { symbol: 'μ_j', text: '第 j 列在训练行上的中心点' },
      { symbol: 'J', text: '压之前的列数' },
    ],
    notes: [
      'pc1…pcK 没有物理含义：读它只能看哪几列的权重大。',
      '⚠ 这一步要求上游先把缺失填掉：压的这几列里只要有一格是空，整步当场报错。',
    ],
  }
}

/** 一条主成分里的一项：权重、中心点与列名，缺一样就不成一项。 */
function pcTerm(
  raw: unknown,
): { key: string; weight: number; center: number } | null {
  const item = recordOf(raw)
  const key = item['key']
  const weight = numberIn(item, 'weight')
  const center = numberIn(item, 'center')
  if (typeof key !== 'string' || weight === null || center === null) return null
  return { key, weight, center }
}

/** 一条主成分的代入式。⚠ 负权重拆成减号：连着写会印成「+ −0.51」。 */
function pcTerms(
  key: string,
  params: Record<string, unknown>,
): FormulaNode[] | null {
  const raw = params['terms']
  if (!Array.isArray(raw)) return null
  const terms = raw.slice(0, MAX_TERMS).map((one) => pcTerm(one))
  const kept = terms.filter((one) => one !== null)
  if (kept.length === 0) return null
  const line = [varOf(key), opOf('=')]
  for (const one of kept) {
    if (line.length > 2) line.push(opOf(one.weight < 0 ? '−' : '+'))
    else if (one.weight < 0) line.push(opOf('−'))
    line.push(
      numOf(Math.abs(one.weight)),
      opOf('·'),
      varOf(`(${one.key} − ${niceNumber(one.center)})`),
    )
  }
  const total = numberIn(params, 'terms_total') ?? kept.length
  const rest = total - kept.length
  const tail = rest > 0 ? [warnOf(`还有 ${niceNumber(rest)} 项没列出来`)] : []
  return [run(...line, ...tail)]
}

function timeParts(context: FormulaContext): FormulaSpec {
  const axis = blockAt(context.blocks, 'axis')
  const offset =
    axis === null ? null : numberIn(axis.payload, 'tz_offset_minutes')
  const parts = textsAt(context.config, 'parts')
  return {
    id: 'parts',
    title: '时刻怎么拆成这几列',
    symbolic: [
      run(varOf('t_local'), opOf('='), varOf('t'), opOf('+'), varOf('Δ')),
      run(
        opOf(','),
        varOf('ts_hour ∈ [0, 23]'),
        opOf(','),
        varOf('ts_dayofweek ∈ [0, 6]'),
        nameOf('（周一 = 0）'),
      ),
    ],
    filled:
      offset === null
        ? null
        : [
            run(
              varOf('Δ'),
              opOf('='),
              numOf(offset),
              nameOf(
                `分钟 = UTC${offset < 0 ? '' : '+'}${niceNumber(offset / 60)}`,
              ),
            ),
          ],
    fallback: offset === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'Δ', text: '业务时区相对 UTC 的偏移' },
      { symbol: 'ts_is_weekend', text: '周几 ≥ 5 记 1，否则记 0' },
    ],
    notes: [
      `这次造的是：${parts.length === 0 ? '按配置那几档' : parts.join('、')}。`,
      '⚠ 口径差一个时区，这几列整体偏几个小时，而每个数看着都在正常范围里。',
    ],
  }
}

function lagShift(context: FormulaContext): FormulaSpec {
  const lags = numbersAt(context.config, 'lags')
  const kept = [...new Set(lags)].sort((left, right) => left - right)
  return {
    id: 'shift',
    title: '滞后列的每一格取的是哪一行',
    symbolic: [
      run(varOf('x@lagL_i'), opOf('=')),
      cases([
        { when: 'i > L', then: [run(varOf('x_{i−L}'))] },
        { when: 'i ≤ L', then: [run(varOf('∅'))] },
      ]),
    ],
    filled:
      kept.length === 0
        ? null
        : [
            run(
              varOf('L'),
              opOf('∈'),
              varOf(`{${kept.map((one) => niceNumber(one)).join(', ')}}`),
              ...(kept.length === lags.length
                ? []
                : [
                    warnOf(
                      `配了 ${niceNumber(lags.length)} 档，去重后只造得出 ${niceNumber(kept.length)} 列`,
                    ),
                  ]),
            ),
          ],
    fallback: kept.length === 0 ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'L', text: '往回取几行' },
      { symbol: 'i', text: '行序，不是时刻' },
    ],
    notes: [
      '⚠ 按**行序**取，不按时刻：中间插了一步改行序的算子，这一列会整片错。',
      '⚠ 前 L 行是空值不是 0：填 0 会把「还没有历史」说成「历史上是 0」。',
      '⚠ 用了这一步的流水线上不了线：推理时拿不到那几行历史。',
    ],
  }
}

function rollingWindow(context: FormulaContext): FormulaSpec {
  const width = numberAt(context.config, 'window')
  const stats = textsAt(context.config, 'stats')
  return {
    id: 'window',
    title: '一格滚动值是在哪几行上算的',
    symbolic: [
      run(
        varOf('S_i'),
        opOf('='),
        varOf('{ x_t : i − W + 1 ≤ t ≤ i, x_t ≠ ∅ }'),
      ),
      run(opOf(','), varOf('m_i'), opOf('='), varOf('|S_i|')),
      run(opOf(','), varOf('std'), opOf('=')),
      sqrt([frac([run(varOf('Σ(x − x̄)²'))], [run(varOf('m_i'))])]),
    ],
    filled:
      width === null
        ? null
        : [
            run(
              varOf('W'),
              opOf('='),
              numOf(width),
              nameOf(`行 = 当前行 + 前 ${niceNumber(width - 1)} 行`),
            ),
          ],
    fallback: width === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'W', text: '窗口长度，含当前行' },
      { symbol: 'm_i', text: '这一格实际用上了几个非空值' },
    ],
    notes: [
      `这次算的是：${stats.length === 0 ? '按配置那几档' : stats.join('、')}。`,
      '⚠ 分母是逐行不同的 m_i：窗口里的空值先被滤掉再折，所以缺失多的那一段上「近 3 期均值」可能只是一个点的值——它与满窗口的均值在图上长得一模一样。',
      `不满窗口的前 ${width === null ? 'W − 1' : niceNumber(width - 1)} 行给空值，不给 0。`,
    ],
  }
}

export const FEATURE_FORMULAS = {
  standardize: [standardScale],
  one_hot: [oneHotRule],
  select_feature: [selectScore],
  pca: [pcaTerms],
  time_feature: [timeParts],
  lag_feature: [lagShift],
  rolling_feature: [rollingWindow],
} as const
