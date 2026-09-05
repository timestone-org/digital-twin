/**
 * @fileoverview 取数与预处理这八个算子的公式骨架（规格 §5 的 1–8 条）。
 *
 * ⚠ 实参只从三处取，取不到就说清是哪一种取不到：这几步的公式代不进参数时，
 * 用户核对不了「界是怎么定出来的」，而那正是他打开这一屏要问的事。
 */
import type { FormulaNode } from './formula'
import { cases, frac, nameOf, numOf, opOf, run, sqrt, varOf } from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import {
  NO_BLOCK,
  NO_CONFIG,
  blockAt,
  firstParams,
  fitParamsOf,
  numberAt,
  numberIn,
  percent,
  textAt,
} from './formulaArgs'
import { niceNumber } from './numbers'

/** 桶宽 config 写的是「1h」这种口径串，毫秒数只有跑完才知道。 */
const BUCKET_MS = 'bucket_ms'

function windowRows(context: FormulaContext): FormulaSpec {
  const limit = numberAt(context.config, 'row_limit')
  const table = textAt(context.config, 'table_code')
  const rows = blockAt(context.blocks, 'rows')
  const took = rows === null ? null : numberIn(rows.payload, 'after')
  return {
    id: 'window',
    title: '取哪些行',
    symbolic: [
      run(
        varOf('rows'),
        opOf('='),
        nameOf('last'),
        varOf('L'),
        varOf('{ r ∈ T : t_since ≤ t(r) ≤ t_until }'),
      ),
    ],
    filled:
      limit === null
        ? null
        : [
            run(
              varOf('rows'),
              opOf('='),
              nameOf('last'),
              numOf(limit),
              varOf(`{ r ∈ ${table === '' ? 'T' : table} : 时间窗内 }`),
              ...(took === null ? [] : [opOf('='), numOf(took), nameOf('行')]),
            ),
          ],
    fallback: limit === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'T', text: '台账表' },
      { symbol: 'L', text: '行数上限 row_limit' },
      { symbol: 'last', text: '反着扫，留下最新的那一批' },
    ],
    notes: [
      '⚠ 触到上限时丢的是**更早**那一批：往后挪时间范围的起点才有用，往前挪只会更满。',
    ],
  }
}

function joinMatch(context: FormulaContext): FormulaSpec {
  const tolerance = numberAt(context.config, 'tolerance_ms')
  const how = textAt(context.config, 'how')
  return {
    id: 'match',
    title: '左边这一行去右边找谁',
    symbolic: [
      run(varOf('j(i)'), opOf('='), nameOf('argmin')),
      run(varOf('|t_j^R − t_i^L|'), nameOf('，且这个差 ≤ τ')),
    ],
    filled:
      tolerance === null
        ? null
        : [
            run(
              varOf('τ'),
              opOf('='),
              numOf(tolerance),
              nameOf('毫秒'),
              opOf('='),
              varOf(`${niceNumber(tolerance / 1000)} 秒`),
            ),
          ],
    fallback: tolerance === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'tᴸ / tᴿ', text: '左表与右表这一行的时刻' },
      { symbol: 'τ', text: '容差 tolerance_ms，超出就算没配上' },
    ],
    notes: [
      how === 'left'
        ? '配不上的左行照样留着，右侧那几列整排是空——不是 0。'
        : '配不上的左行整行丢掉。',
      '一条右行可以被好几条左行同时配上：那等于这一步做了一次前向填充。',
    ],
  }
}

function castRule(context: FormulaContext): FormulaSpec {
  const onError = textAt(context.config, 'on_error')
  const to = textAt(context.config, 'to')
  const rows: { when: string; then: FormulaNode[] }[] = [
    { when: 'v 是空', then: [run(varOf('∅'))] },
    { when: 'v 是 true / false', then: [run(varOf('1.0 / 0.0'))] },
    { when: 'v 解析得动', then: [run(nameOf(`${to === '' ? 'number' : to}(v)`))] },
    {
      when: onError === 'error' ? '解析不动（当前配置）' : '解析不动',
      then: [run(onError === 'error' ? varOf('当场报错') : varOf('∅'))],
    },
  ]
  return {
    id: 'cast',
    title: '一个格子怎么换类型',
    symbolic: [run(nameOf('cast(v)'), opOf('=')), cases(rows)],
    filled: null,
    fallback: null,
    isOpen: false,
    legend: [{ symbol: 'v', text: '换之前那一格的原值' }],
    notes: [
      onError === 'coerce'
        ? '解析不动的格子变成空值，这一步不报错：转坏了多少格看上面那张账。'
        : '解析不动就整步报错，一格都不换。',
    ],
  }
}

/** 丢行档与丢列档判的是两件事，符号态因此不是同一条式子。 */
function dropShape(isColumn: boolean, isAny: boolean): FormulaNode[] {
  if (isColumn) {
    return [
      run(varOf('ρ_c'), opOf('=')),
      frac([run(varOf('这一列空着的格数'))], [run(varOf('n'))]),
      run(nameOf('，丢掉 c ⟺ ρ_c > θ')),
    ]
  }
  const rule = isAny ? '判据列里一个空都没有' : '判据列不是全空（全空才丢）'
  return [run(nameOf('keep(i)'), opOf('⟺'), varOf(rule))]
}

function dropRule(context: FormulaContext): FormulaSpec {
  const how = textAt(context.config, 'how')
  const axis = textAt(context.config, 'axis')
  const theta = numberAt(context.config, 'max_null_ratio')
  const isAny = how !== 'all'
  return {
    id: 'drop',
    title: axis === 'column' ? '哪几列被丢掉' : '哪几行被丢掉',
    symbolic: dropShape(axis === 'column', isAny),
    filled:
      axis === 'column' && theta !== null
        ? [
            run(
              varOf('θ'),
              opOf('='),
              numOf(theta),
              opOf('='),
              varOf(percent(theta)),
            ),
          ]
        : null,
    fallback: axis === 'column' && theta === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'n', text: '这一步之前的总行数' },
      { symbol: 'θ', text: '空值率上限 max_null_ratio' },
    ],
    notes: [
      axis === 'column'
        ? '阈值再调低一点会连哪一列一起丢掉，看上面那张各列空值率对阈值的图。'
        : isAny
          ? '判据列里只要有一个空就丢这一行。'
          : '判据列全是空才丢这一行。',
    ],
  }
}

/** 比较档一律把空值当「丢弃」，不当 0 参与比较——这条最容易记反。 */
function filterRule(context: FormulaContext): FormulaSpec {
  const op = textAt(context.config, 'op')
  const column = textAt(context.config, 'column')
  const value = numberAt(context.config, 'value')
  const name = column === '' ? 'x' : column
  const marks: Record<string, string> = {
    gte: '≥',
    gt: '>',
    lte: '≤',
    lt: '<',
    eq: '=',
    ne: '≠',
  }
  const mark = marks[op] ?? ''
  const isCompare = mark !== ''
  return {
    id: 'keep',
    title: '哪些行留下来',
    symbolic: [
      run(nameOf('keep(i)'), opOf('⟺')),
      cases([
        { when: 'op 是比较', then: [run(varOf('xᵢ ≠ ∅ 且 xᵢ ⋈ v'))] },
        { when: 'op = is_blank', then: [run(varOf('xᵢ = ∅'))] },
        { when: 'op = not_blank', then: [run(varOf('xᵢ ≠ ∅'))] },
      ]),
    ],
    filled:
      isCompare && value !== null
        ? [
            run(
              nameOf('keep(i)'),
              opOf('⟺'),
              varOf(`${name} ≠ ∅`),
              opOf('且'),
              varOf(`${name} ${mark} ${niceNumber(value)}`),
            ),
          ]
        : null,
    fallback: isCompare && value === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [{ symbol: 'xᵢ', text: `第 i 行「${name}」这一格的值` }],
    notes: [
      isCompare
        ? '⚠ 这一格是空的行一律丢弃，不拿它当 0 去比——丢了多少行看上面那张账。'
        : '这一档判的是空不空，不做大小比较。',
    ],
  }
}

function resampleBucket(context: FormulaContext): FormulaSpec {
  const axis = blockAt(context.blocks, 'axis')
  const width = axis === null ? null : numberIn(axis.payload, BUCKET_MS)
  const offset = axis === null ? null : numberIn(axis.payload, 'tz_offset_minutes')
  const agg = textAt(context.config, 'agg')
  return {
    id: 'bucket',
    title: '一行落进哪个桶',
    symbolic: [
      run(nameOf('b(t)'), opOf('='), varOf('⌊(t + Δ) / w⌋'), opOf('·'), varOf('w'), opOf('−'), varOf('Δ')),
    ],
    filled:
      width === null || offset === null
        ? null
        : [
            run(
              varOf('w'),
              opOf('='),
              numOf(width),
              nameOf('毫秒'),
              opOf(','),
              varOf('Δ'),
              opOf('='),
              numOf(offset),
              nameOf(`分钟（UTC${offset < 0 ? '' : '+'}${niceNumber(offset / 60)}）`),
            ),
          ],
    fallback: width === null || offset === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'w', text: '桶宽' },
      { symbol: 'Δ', text: '业务时区相对 UTC 的偏移' },
      { symbol: 'b(t)', text: '这一行归到哪个桶的起点时刻' },
    ],
    notes: [
      '⚠ 按 UTC 切一天在东八区会整体偏 8 小时，而每个数看着都完全正常——这就是要看 Δ 的原因。',
      `桶里这几行按 ${agg === '' ? 'avg' : agg} 折成一行。`,
    ],
  }
}

function fillValue(context: FormulaContext): FormulaSpec {
  const block = blockAt(context.blocks, 'fits')
  const head = firstParams(fitParamsOf(block))
  const strategy = textAt(context.config, 'strategy')
  const value = head === null ? null : numberIn(head[1], 'fill')
  return {
    id: 'fill',
    title: '拿什么数去填',
    symbolic: [
      run(
        varOf('x̂_c'),
        opOf('='),
        nameOf(strategy === 'value' ? 'value' : `${strategy === '' ? 'mean' : strategy}`),
        varOf('{ x_{i,c} : i ∈ 训练行, x ≠ ∅ }'),
      ),
    ],
    filled:
      head === null || value === null
        ? null
        : [run(varOf(`x̂(${head[0]})`), opOf('='), numOf(value))],
    fallback: head === null || value === null ? NO_BLOCK : null,
    isOpen: false,
    legend: [
      { symbol: 'x̂_c', text: '这一列用来填空的那个数' },
      { symbol: '训练行', text: '将来会进训练集的那些行' },
    ],
    notes: [
      '⚠ 填充值只在**训练行**上学：拿界面上那一列的全表均值去核对是对不上的，这是刻意设计，防的是把测试集的信息漏进训练。',
    ],
  }
}

function clipBound(context: FormulaContext): FormulaSpec {
  const items = fitParamsOf(blockAt(context.blocks, 'fits'))
  const head = firstParams(items)
  const method = textAt(context.config, 'method')
  const isZ = method !== 'iqr'
  return {
    id: 'bound',
    title: '上下界是怎么定出来的',
    symbolic: isZ
      ? [
          run(varOf('σ'), opOf('=')),
          sqrt([frac([run(varOf('Σ(xᵢ − μ)²'))], [run(varOf('n'))])]),
          run(opOf(','), varOf('[lo, hi]'), opOf('='), varOf('[μ − kσ, μ + kσ]')),
        ]
      : [
          run(varOf('IQR'), opOf('='), varOf('Q₃ − Q₁')),
          run(opOf(','), varOf('[lo, hi]'), opOf('='), varOf('[Q₁ − k·IQR, Q₃ + k·IQR]')),
        ],
    filled: head === null ? null : boundLine(head[0], head[1], isZ),
    fallback: head === null ? NO_BLOCK : null,
    isOpen: true,
    legend: isZ
      ? [
          { symbol: 'μ / σ', text: '训练行上的均值与标准差（总体口径，除 n）' },
          { symbol: 'k', text: '配置里的倍数 threshold' },
        ]
      : [
          { symbol: 'Q₁ / Q₃', text: '训练行上的上下四分位数' },
          { symbol: 'k', text: '配置里的倍数 threshold' },
        ],
    notes: [
      '⚠ 界在**训练行**上定、却裁**整帧**：裁后的最大值正好等于 hi 时，说明有测试行超出了训练时见过的范围。',
      'k 配得大到一行都没碰到界时，这一列的最大最小值就是它本来的极值，不是这一步定的界。',
    ],
  }
}

/** 定界那一行代入：z 档与 iqr 档取的不是同一组数。 */
function boundLine(
  key: string,
  params: Record<string, unknown>,
  isZ: boolean,
): FormulaNode[] | null {
  const low = numberIn(params, 'low')
  const high = numberIn(params, 'high')
  const k = numberIn(params, 'k')
  if (low === null || high === null || k === null) return null
  const lead = isZ
    ? [
        varOf('μ'),
        opOf('='),
        numOf(numberIn(params, 'mean') ?? 0),
        opOf(','),
        varOf('σ'),
        opOf('='),
        numOf(numberIn(params, 'sd') ?? 0),
      ]
    : [
        varOf('Q₁'),
        opOf('='),
        numOf(numberIn(params, 'q1') ?? 0),
        opOf(','),
        varOf('Q₃'),
        opOf('='),
        numOf(numberIn(params, 'q3') ?? 0),
      ]
  return [
    run(nameOf(key), opOf('：'), ...lead, opOf(','), varOf('k'), opOf('='), numOf(k)),
    run(varOf('[lo, hi]'), opOf('='), varOf(`[${niceNumber(low)}, ${niceNumber(high)}]`)),
  ]
}

export const CLEAN_FORMULAS = {
  ledger_source: [windowRows],
  ledger_join: [joinMatch],
  cast_type: [castRule],
  drop_missing: [dropRule],
  filter_rows: [filterRule],
  resample: [resampleBucket],
  fill_missing: [fillValue],
  clip_outlier: [clipBound],
} as const
