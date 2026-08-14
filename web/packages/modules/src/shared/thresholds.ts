/**
 * @fileoverview 告警阈值评估：把「一个实时值 + 一组规则」算成「严重度 + 颜色 + 闪烁 + 文案」。
 * ⚠ 颜色只给 CSS 变量引用，不给具体色值——换肤时由级联自动重着色，
 * 而算出来的十六进制会原地钉死在那一套配色上。
 */
import type { ConfigField, ConfigOption } from '@dt/contracts'

import {
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readTrimmedText,
} from './config'
import { isPresent } from './format'

/** 严重度，升序排列。 */
export const THRESHOLD_LEVELS = ['normal', 'info', 'warning', 'danger'] as const
export type ThresholdLevel = (typeof THRESHOLD_LEVELS)[number]

/** 比较运算符；`between` / `outside` 用闭区间 [value, value2]。 */
export const THRESHOLD_OPS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'outside',
  'eq',
  'neq',
] as const
export type ThresholdOp = (typeof THRESHOLD_OPS)[number]

/** 一条阈值规则。 */
export interface ThresholdRule {
  op: ThresholdOp
  value: number
  /** 区间上界，仅 `between` / `outside` 有意义。 */
  value2?: number
  level: ThresholdLevel
  label?: string
  blink?: boolean
}

/** 命中一条规则的结果。 */
export interface ThresholdHit {
  level: ThresholdLevel
  /** CSS 变量引用，跟着主题走。 */
  color: string
  blink: boolean
  label?: string
}

/** 严重度权重，越大越严重。 */
export const SEVERITY_RANK: Record<ThresholdLevel, number> = {
  normal: 0,
  info: 1,
  warning: 2,
  danger: 3,
}

/** 严重度对应的颜色变量。 */
export const LEVEL_VAR: Record<ThresholdLevel, string> = {
  normal: 'var(--state-success)',
  info: 'var(--state-info)',
  warning: 'var(--state-warning)',
  danger: 'var(--state-danger)',
}

/**
 * 严重度的颜色变量引用。
 * @param level 严重度
 */
export function levelColor(level: ThresholdLevel): string {
  return LEVEL_VAR[level]
}

/**
 * 这一档算不算告警。
 * @param level 严重度
 */
export function isAlarmLevel(level: ThresholdLevel): boolean {
  return SEVERITY_RANK[level] > SEVERITY_RANK.normal
}

// 单值比较查表：写成表而不是 switch，加一档运算符不必再动分支
const COMPARATORS: Partial<
  Record<ThresholdOp, (value: number, bound: number) => boolean>
> = {
  lt: (value, bound) => value < bound,
  lte: (value, bound) => value <= bound,
  gt: (value, bound) => value > bound,
  gte: (value, bound) => value >= bound,
  eq: (value, bound) => value === bound,
  neq: (value, bound) => value !== bound,
}

/**
 * 一条规则中不中。
 * ⚠ 区间档缺上界一律判不中：拿单值当区间比会让「10 到 20 报警」变成「≥10 就报警」。
 * @param value 实时值
 * @param rule 已规整过的规则
 */
function matchRule(value: number, rule: ThresholdRule): boolean {
  const compare = COMPARATORS[rule.op]
  if (compare !== undefined) return compare(value, rule.value)
  const upper = rule.value2
  if (upper === undefined) return false
  const low = Math.min(rule.value, upper)
  const high = Math.max(rule.value, upper)
  return rule.op === 'between'
    ? value >= low && value <= high
    : value < low || value > high
}

/**
 * 评估一组规则，取**声明序**里第一条命中的。
 * ⚠ 缺值与没配规则都返回 null，不给兜底色：凭空一个绿色等于宣布「一切正常」，
 * 而这时候我们根本没有值。
 * @param value 实时值
 * @param rules 已经过 `normalizeRules` 规整的规则
 */
export function evaluateThresholds(
  value: unknown,
  rules: readonly ThresholdRule[],
): ThresholdHit | null {
  if (!isPresent(value)) return null
  for (const rule of rules) {
    if (!matchRule(value, rule)) continue
    return {
      level: rule.level,
      color: levelColor(rule.level),
      blink: rule.blink === true,
      ...(rule.label !== undefined ? { label: rule.label } : {}),
    }
  }
  return null
}

/**
 * 把配置里的一行规整成规则；认不出运算符或阈值就丢掉这一行。
 * @param raw 配置数组里的一行
 */
function toRule(raw: unknown): ThresholdRule | null {
  const row = readRecord(raw)
  const op = THRESHOLD_OPS.find((item) => item === row.op)
  if (op === undefined) return null
  const value = readNumber(row.value, Number.NaN)
  if (!Number.isFinite(value)) return null
  const upper = readNumber(row.value2, Number.NaN)
  const label = readTrimmedText(row.label)
  return {
    op,
    value,
    level: readEnum(row.level, THRESHOLD_LEVELS, 'warning'),
    blink: readBoolean(row.blink),
    ...(Number.isFinite(upper) ? { value2: upper } : {}),
    ...(label !== '' ? { label } : {}),
  }
}

/**
 * 把 `type: 'array'` 字段的原值规整成强类型规则表，脏行直接丢。
 * ⚠ 这是本文件唯一的不可信输入口：过了这道门之后的规则一律当作已校验，
 * 每一层都再校验一遍只会让「到底谁负责挡」说不清楚。
 * @param raw 配置里读出来的原值
 */
export function normalizeRules(raw: unknown): ThresholdRule[] {
  const rules: ThresholdRule[] = []
  for (const row of readArray(raw)) {
    const rule = toRule(row)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

/** 运算符下拉项。 */
export const OP_OPTIONS: ConfigOption[] = [
  { value: 'lt', label: '< 小于' },
  { value: 'lte', label: '≤ 小于等于' },
  { value: 'gt', label: '> 大于' },
  { value: 'gte', label: '≥ 大于等于' },
  { value: 'between', label: '区间内 [a,b]' },
  { value: 'outside', label: '区间外' },
  { value: 'eq', label: '= 等于' },
  { value: 'neq', label: '≠ 不等于' },
]

/** 严重度下拉项。 */
export const LEVEL_OPTIONS: ConfigOption[] = [
  { value: 'normal', label: '正常（绿）' },
  { value: 'info', label: '提示（蓝）' },
  { value: 'warning', label: '警告（黄）' },
  { value: 'danger', label: '危险（红）' },
]

/**
 * 生成「阈值规则」配置字段，模块直接铺进自己的 `configSchema`。
 * @param key 字段键
 * @param label 字段标签
 * @param help 标签旁的说明
 */
export function thresholdsConfigField(
  key = 'thresholds',
  label = '阈值规则',
  help = '按声明顺序取首个命中，高危规则放前面；缺值与非数不告警。',
): ConfigField {
  return {
    key,
    label,
    type: 'array',
    help,
    itemSchema: [
      {
        key: 'op',
        label: '判断',
        type: 'enum',
        default: 'gt',
        options: OP_OPTIONS,
      },
      { key: 'value', label: '阈值', type: 'number', default: 0 },
      {
        key: 'value2',
        label: '阈值上界',
        type: 'number',
        when: { key: 'op', in: ['between', 'outside'] },
      },
      {
        key: 'level',
        label: '严重度',
        type: 'enum',
        default: 'warning',
        options: LEVEL_OPTIONS,
      },
      { key: 'label', label: '告警文案', type: 'string', default: '' },
      { key: 'blink', label: '闪烁', type: 'boolean', default: false },
    ],
    itemLabelKey: 'level',
    default: [],
  }
}
