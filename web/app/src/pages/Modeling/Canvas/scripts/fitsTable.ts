/**
 * @fileoverview `fits` 块的取料：逐列一行的表、图下那句结论、逐列一行的公式。
 *
 * ⚠ `params` 的键随算子而异（填充是 `fill`、尺度是 `center`/`scale`、定界是
 * `low`/`high`），列由数据自适应展开而不是写死一张表——写死的那张表换个算子
 * 就整片空着，而每个格子看着都很正常（MODELING_RESULT_VIEW_DESIGN §5-8）。
 */
import type { FormulaNode, FormulaTerm } from './formula'
import { frac, nameOf, numOf, opOf, run, varOf, warnOf } from './formula'
import { niceNumber, percentText } from './numbers'
import type { FitSummary } from './reportBlocks'
import { recordOf } from './reportBlocks'

/** 后端 `reporting.py::MAX_FIT_COLUMNS`：逐列表最多这么多列。 */
export const MAX_FIT_COLUMNS = 60

/** 算不出来的格子一律这一个字，不写 0（规格 §2-P4）。 */
export const BLANK = '—'

/** 逐列表里的一行。 */
export interface FitRow {
  key: string
  params: Record<string, unknown>
  /** 这一列为什么没被处理；空串 = 处理过。 */
  skippedReason: string
}

/** 表上的一列。⚠ 与 `DtTableColumn` 结构兼容，`slot` 是它的单元格插槽名。 */
export interface FitColumn {
  key: string
  label: string
  width: string
  align: 'left' | 'right'
  slot: string
}

/** 表上的一行，值已经排好版——模板里不再做格式化。 */
export interface FitTableRow {
  id: string
  name: string
  values: Record<string, string>
  reason: string
}

/** 表下方的一条公式。 */
export interface FitFormula {
  key: string
  nodes: FormulaNode[]
}

// 参数键的中文名。认不出来的键原样印——吞掉它等于把一列数悄悄藏起来
const PARAM_LABELS: Record<string, string> = {
  fill: '填充值',
  filled: '填了几格',
  null_ratio_before: '填前空值率',
  fit_rows: '拟合样本数',
  k: '倍数 k',
  mean: '均值 μ',
  sd: '标准差 σ',
  q1: '下四分位 Q1',
  q3: '上四分位 Q3',
  low: '下界',
  high: '上界',
  clipped_low: '夹回下界',
  clipped_high: '夹回上界',
  untouched: '没动的格',
  train_low: '训练段最小',
  train_high: '训练段最大',
  all_low: '全帧最小',
  all_high: '全帧最大',
  beyond_train: '全帧超出训练段',
  center: '中心',
  scale: '跨度',
  before_min: '缩放前最小',
  before_p50: '缩放前中位',
  before_mean: '缩放前均值',
  before_max: '缩放前最大',
  after_min: '缩放后最小',
  after_p50: '缩放后中位',
  after_mean: '缩放后均值',
  after_max: '缩放后最大',
  categories: '类目数',
  kept: '留下',
  cut: '砍掉',
  hit_rows: '命中行',
  unseen_rows: '未见过类目的行',
  blank_rows: '空值行',
  unseen_ratio: '未见过占比',
  blank_ratio: '空值占比',
  explained: '解释方差',
  cumulative: '累计解释',
  terms_total: '项数',
  coef: '系数 β',
  sigma: '这一列的 σ',
  contribution: '可比贡献 |β·σ|',
  odds_ratio: '几率比 e^β',
}

/**
 * 0–1 的比率，按百分数印。⚠ 走 `niceNumber` 会把 0.375 印成 0.375 而不是 37.5%。
 *
 * ⚠ 逐个列名字，不许按 `ratio` 这个词去认：`odds_ratio` 是几率比 e^β，一个**倍
 * 数**——按词认会把 8.3362 印成「833.6%」，与同屏算式上的那个数差两个数量级。
 * 新键漏登记只会印成一个原样的小数，比印错量级安全。
 */
const RATIO_KEYS = new Set([
  'explained',
  'cumulative',
  'null_ratio_before',
  'unseen_ratio',
  'blank_ratio',
])

function isRatio(key: string): boolean {
  return RATIO_KEYS.has(key)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 把 `by_column` 读成逐列一行。读不出来的字段照实退化，不补默认值。Args: fit。 */
export function fitRowsOf(fit: FitSummary): FitRow[] {
  return fit.byColumn.map((item) => ({
    key: asText(item['key']),
    params: recordOf(item['params']),
    skippedReason: asText(item['skipped_reason']),
  }))
}

/**
 * 一个格子怎么印。
 *
 * ⚠ 嵌套值（pca 的 `terms`）一律给「—」：整个数组塞进一个单元格既读不出来
 * 也会把整张表撑垮，它归表格下方的公式那一段。
 * Args: key, value。
 */
function cellText(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string') return value === '' ? BLANK : value
  const number = asNumber(value)
  if (number === null) return BLANK
  return isRatio(key) ? percentText(number * 100) : niceNumber(number)
}

/** 能不能摆进单元格。数组与对象不能——它们归公式那一段。Args: value。 */
function isCellable(value: unknown): boolean {
  return typeof value !== 'object' || value === null
}

/**
 * 参数列：逐行取并集，按第一次出现的顺序排。
 *
 * ⚠ 只收标量：某一列的某个参数是数组时，那个键整列都不建成表列。
 * Args: rows。
 */
export function fitColumnsOf(rows: readonly FitRow[]): FitColumn[] {
  const made: FitColumn[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.params)) {
      if (seen.has(key) || !isCellable(value)) continue
      seen.add(key)
      made.push({
        key,
        label: PARAM_LABELS[key] ?? key,
        width: '8rem',
        align: 'right',
        slot: `cell-${key}`,
      })
    }
  }
  return made
}

/** 表上的行，值逐格排好版。Args: rows, columns。 */
export function fitTableRowsOf(
  rows: readonly FitRow[],
  columns: readonly FitColumn[],
): FitTableRow[] {
  return rows.map((row, at) => {
    const values: Record<string, string> = {}
    for (const column of columns) {
      values[column.key] = cellText(column.key, row.params[column.key])
    }
    return {
      id: `${at}:${row.key}`,
      name: row.key,
      values,
      reason: row.skippedReason,
    }
  })
}

/** 有没有列写了跳过理由；一条都没有时那一列不摆。Args: rows。 */
export function hasSkipped(rows: readonly FitRow[]): boolean {
  return rows.some((row) => row.skippedReason !== '')
}

/**
 * 训练行与总行数那一句。
 *
 * ⚠ 两个数相等反而可疑：带拟合的算子只在训练行上学统计量（防泄漏），
 * 相等意味着这一步前面没有切分，学到的东西已经见过测试段。
 * Args: fit。
 */
function rowsSentence(fit: FitSummary): string {
  const { trainRows, totalRows } = fit
  if (totalRows === 0) {
    return `在 ${niceNumber(trainRows)} 个训练行上学；总行数没有记下，算不出占比`
  }
  if (trainRows === totalRows) {
    return (
      `训练行 ${niceNumber(trainRows)} 行与总行数相同：` +
      '这一步之前没有切分，统计量是在整帧上学的'
    )
  }
  const share = percentText((trainRows / totalRows) * 100)
  return (
    `在 ${niceNumber(trainRows)} 个训练行上学、` +
    `${niceNumber(totalRows)} 行全帧照这一份处理（训练行占 ${share}）`
  )
}

/** 逐列学没学出来那一句。Args: rows。 */
function columnsSentence(rows: readonly FitRow[]): string {
  const skipped = rows.filter((row) => row.skippedReason !== '').length
  const total = niceNumber(rows.length)
  if (skipped === 0) return `${total} 列全部学出了参数`
  return `${total} 列里 ${niceNumber(skipped)} 列没学出参数，理由逐列写在表上`
}

/**
 * 表下那行看得见的结论（规格 §2-P6）。一句都说不出来时给空串。
 * Args: fit, rows。
 */
export function fitsSummary(fit: FitSummary, rows: readonly FitRow[]): string {
  const parts: string[] = []
  if (fit.method !== '') parts.push(`拟合方法：${fit.method}`)
  parts.push(rowsSentence(fit))
  if (rows.length > 0) parts.push(columnsSentence(rows))
  if (rows.length >= MAX_FIT_COLUMNS) {
    parts.push(
      `只列了前 ${MAX_FIT_COLUMNS} 列——已经到上限，更靠后的列没有列出来`,
    )
  }
  return parts.join('；')
}

/** 一项的权重与它的符号：负权重走减号，免得排出「+ -0.7071」。Args: weight。 */
function signedTerms(weight: number, isFirst: boolean): FormulaTerm[] {
  const sign = weight < 0 ? opOf('−') : opOf('+')
  const lead = isFirst && weight >= 0 ? [] : [sign]
  return [...lead, numOf(Math.abs(weight))]
}

/** pca 那一条轴的线性组合。Args: key, params。 */
function axisFormula(
  key: string,
  params: Record<string, unknown>,
): FormulaNode[] | null {
  const raw = params['terms']
  if (!Array.isArray(raw)) return null
  const terms: FormulaTerm[] = [varOf(key), opOf('=')]
  let placed = 0
  for (const item of raw) {
    const one = recordOf(item)
    const weight = asNumber(one['weight'])
    const center = asNumber(one['center'])
    if (weight === null) continue
    terms.push(...signedTerms(weight, placed === 0))
    terms.push(opOf('·'), opOf('('), varOf(asText(one['key'])))
    if (center !== null) terms.push(opOf('−'), numOf(center))
    terms.push(opOf(')'))
    placed += 1
  }
  if (placed === 0) return null
  const rest = (asNumber(params['terms_total']) ?? 0) - raw.length
  if (rest > 0) {
    terms.push(opOf('+'), warnOf(`另有 ${niceNumber(rest)} 项没列出`))
  }
  return [run(...terms)]
}

/** 逐列的公式：谁的参数齐了就画谁的，一条都凑不出来时给 null。Args: row。 */
export function fitFormulaOf(row: FitRow): FormulaNode[] | null {
  const params = row.params
  const axis = axisFormula(row.key, params)
  if (axis !== null) return axis
  const center = asNumber(params['center'])
  const scale = asNumber(params['scale'])
  if (center !== null && scale !== null && scale !== 0) {
    return [
      run(varOf(`${row.key}′`), opOf('=')),
      frac(
        [run(opOf('('), varOf(row.key), opOf('−'), numOf(center), opOf(')'))],
        [run(numOf(scale))],
      ),
    ]
  }
  const low = asNumber(params['low'])
  const high = asNumber(params['high'])
  if (low !== null && high !== null) {
    return [
      run(
        varOf(row.key),
        opOf('='),
        opOf('min'),
        opOf('('),
        opOf('max'),
        opOf('('),
        varOf(row.key),
        opOf(','),
        numOf(low),
        opOf(')'),
        opOf(','),
        numOf(high),
        opOf(')'),
      ),
    ]
  }
  return plainFormulaOf(row, params)
}

/** 填充值与系数那两条：形状简单，与上面那三条分开写好各自读得懂。Args: row, params。 */
function plainFormulaOf(
  row: FitRow,
  params: Record<string, unknown>,
): FormulaNode[] | null {
  const fill = asNumber(params['fill'])
  if (fill !== null) {
    return [
      run(
        varOf(row.key),
        opOf('='),
        numOf(fill),
        nameOf('（原值为空的那些行）'),
      ),
    ]
  }
  const coef = asNumber(params['coef'])
  if (coef === null) return null
  const terms: FormulaTerm[] = [
    varOf('β'),
    opOf('('),
    varOf(row.key),
    opOf(')'),
    opOf('='),
    numOf(coef),
  ]
  const odds = asNumber(params['odds_ratio'])
  if (odds !== null) {
    terms.push(opOf(','), varOf('e^β'), opOf('='), numOf(odds))
  }
  return [run(...terms)]
}

/** 表格下方那一段：一列一行，凑不出公式的列不占一行。Args: rows。 */
export function fitFormulasOf(rows: readonly FitRow[]): FitFormula[] {
  const made: FitFormula[] = []
  for (const row of rows) {
    const nodes = fitFormulaOf(row)
    if (nodes !== null) made.push({ key: row.key, nodes })
  }
  return made
}
