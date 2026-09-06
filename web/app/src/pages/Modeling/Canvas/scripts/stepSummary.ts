/**
 * @fileoverview ① 区的取料：参数 chips 与「会导致错误结论」的那几条告警。
 *
 * ⚠ chips 取的是 `ModelingRun.graph.nodes[].config`——运行时冻结的快照，所以
 * 历史回看也是当时那份参数，且零后端（MODELING_RESULT_VIEW_DESIGN §6）。
 */
import { niceNumber } from './numbers'
import type { FormField } from './schemaForm'
import { fieldsOf, isDefault } from './schemaForm'

/** ① 区最多摆几个 chip，其余收起来（规格 §3.2 的版面预算）。 */
export const MAX_CHIPS = 6

/**
 * 一句话 gist 收起时的字数线。
 *
 * ⚠ 这是「大概三行」的代理而不是实测行数：真行数要等布局算完才知道，
 * 而那时改版式会跳一次版，测试环境也量不出来。
 */
export const GIST_CHARS = 60

/** 名称一律收在这个长度内，全名进 tooltip。 */
const MAX_CHIP_TEXT = 24

/** 数组类参数最多逐项列这么多个，再多只报个数。 */
const MAX_LISTED = 3

/** 一个参数 chip。 */
export interface StepChip {
  key: string
  label: string
  value: string
  /** 这一项就是 schema 给的默认值——淡着摆，用户改过的那几个才该抢眼。 */
  isDefault: boolean
}

/**
 * 会导致错误结论的那几条，占一整行的醒目条（规格 §11 的 R-24）。
 *
 * ⚠ 只有这四个算子在这张表上：其余口径说明一律进小问号。把「说明」也做成
 * 整行告警之后，一屏五六条彩色横条，真正要紧的那两条就跟着一起被略过了。
 */
export const STEP_ALERTS: Record<string, readonly string[]> = {
  filter_rows: [
    '比较档一律把空值当成不满足条件丢掉，不是当 0 参与比较。上面那个丢弃数里' +
      '含着这一批——要留下它们，得先在这一步之前填缺失。',
  ],
  resample: [
    '桶按运行时注入的时区偏移切，不是按 UTC 切：按 UTC 切一天在东八区会整体' +
      '偏 8 小时，而每一个数看着都完全正常。',
  ],
  rolling_feature: [
    '滚动窗口的分母逐行不同：窗口内先滤掉空值、再按剩下的个数折。缺失多的那' +
      '一段上「近 N 期均值」可能只是一个点的值，它与满窗口的均值在图上长得' +
      '一模一样。',
    '这一步让整条流水线不可上线：推理要带上同样长的历史窗口，而那是发布那一' +
      '刻才会被拦下来的。',
  ],
  lag_feature: [
    '前 L 行没有历史因而为空。填 0 会把「还没有历史」说成「历史上是 0」，' +
      '而这两件事在模型看来完全不同。',
    '这一步让整条流水线不可上线：推理要带上同样长的历史窗口，而那是发布那一' +
      '刻才会被拦下来的。',
  ],
}

/** 这个算子有哪几条必须被看见的告警。认不出的算子一条都没有。Args: operator。 */
export function stepAlertsOf(operator: string): readonly string[] {
  return STEP_ALERTS[operator] ?? []
}

/** 太长的取值收成省略号：chip 是一行里的一小块，撑开它会把整行挤散。Args: text。 */
function clipped(text: string): string {
  if (text.length <= MAX_CHIP_TEXT) return text
  return `${text.slice(0, MAX_CHIP_TEXT)}…`
}

/** 一串取值：三项以内逐项列，再多只报个数。Args: items。 */
function listText(items: readonly unknown[]): string {
  const texts = items.map((item) =>
    typeof item === 'string' ? item : String(item),
  )
  if (texts.length === 0) return ''
  if (texts.length > MAX_LISTED) return `${niceNumber(texts.length)} 项`
  return clipped(texts.join('、'))
}

/**
 * 一个参数印成什么。印不出来的（空串 / 空数组 / null / 嵌套对象）给空串，
 * 由调用方整条丢掉——摆一个「目标列 —」等于用一个位置说了句废话。
 * Args: value, field。
 */
function chipText(value: unknown, field: FormField | undefined): string {
  if (typeof value === 'boolean') return value ? '开' : '关'
  if (typeof value === 'number')
    return Number.isFinite(value) ? niceNumber(value) : ''
  if (typeof value === 'string') {
    const option = field?.options.find((one) => one.value === value)
    return clipped(option?.label ?? value)
  }
  if (Array.isArray(value)) return listText(value)
  return ''
}

/**
 * 参数 chips：schema 声明过的字段按声明序排在前，schema 里没有的排在后面。
 *
 * ⚠ schema 里没有的键照印不吞掉：那多半是老运行留下的参数，吞掉之后界面
 * 印出来的那份参数与真正跑的那份不是同一份。
 * Args: config, schema。
 */
export function stepChipsOf(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
): StepChip[] {
  const fields = fieldsOf(schema)
  const known = new Map(fields.map((field) => [field.key, field]))
  const order = [
    ...fields.map((field) => field.key).filter((key) => key in config),
    ...Object.keys(config).filter((key) => !known.has(key)),
  ]
  const made: StepChip[] = []
  for (const key of order) {
    const field = known.get(key)
    const value = chipText(config[key], field)
    if (value === '') continue
    made.push({
      key,
      label: field?.label ?? key,
      value,
      isDefault: field !== undefined && isDefault(field, config[key]),
    })
  }
  return made
}
