/**
 * @fileoverview gauge-card 自带的值规则表：行比 `shared/thresholds.ts` 的多一个 `color`，
 * 求值口径仍是那一份——逐条调 `evaluateThresholds` 取声明序里的首个命中，再用规则自己的
 * 颜色盖掉语义色（MODULE_INFO_CARD_DESIGN §3）。
 * ⚠ 与 info-card / info-list 的同名文件各带一份、**不许互相 import**：一个模块一个目录是
 * 可达集扫描的前提，跨目录取件会让「这个模块用到了哪些文件」再也数不清。
 * ⚠ 求值器假定规则已规整：认不出的 `op` 在它那里查不到比较器，会掉进区间分支按 `outside`
 * 算（`value2` 缺席时则一律判不中），两种误判都不报错。这道门只能由本文件把住。
 */
import type { ConfigField } from '@dt/contracts'

import {
  readArray,
  readBoolean,
  readEnum,
  readLooseNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import {
  evaluateThresholds,
  LEVEL_OPTIONS,
  OP_OPTIONS,
  THRESHOLD_LEVELS,
  THRESHOLD_OPS,
  type ThresholdLevel,
  type ThresholdOp,
  type ThresholdRule,
} from '../../shared/thresholds'

/** 一条值规则。`color` 空串 = 跟随 `level` 的语义色。 */
export interface ValueRule {
  op: ThresholdOp
  value: number
  /** 区间上界，只有 `between` / `outside` 用得上；`null` = 没配。 */
  value2: number | null
  /** 只管严重度，不决定颜色。 */
  level: ThresholdLevel
  color: string
  label: string
  blink: boolean
}

/** 命中一条规则的结论。 */
export interface ValueHit {
  level: ThresholdLevel
  /** 规则自己的颜色，留空时回落该 `level` 的语义色。 */
  color: string
  label: string
  blink: boolean
}

/**
 * 一条值规则摊成求值器认的形状。
 * ⚠ `value2` 只在有值时写键：`exactOptionalPropertyTypes` 下写 `undefined` 与不写键
 * 不是一回事，而求值器判的正是「键在不在」。
 * @param rule 已规整的值规则
 */
function toThresholdRule(rule: ValueRule): ThresholdRule {
  return {
    op: rule.op,
    value: rule.value,
    level: rule.level,
    blink: rule.blink,
    ...(rule.value2 === null ? {} : { value2: rule.value2 }),
  }
}

/**
 * 把配置里的一行规整成规则；认不出运算符或阈值就丢掉这一行。
 * ⚠ 阈值走 `readLooseNumber` 而不是 `readNumber`：规则表是手填与 JSON 粘贴的地方，
 * 带引号的 `'80'` 在 `readNumber` 眼里不是数，整条规则会被静默丢掉。
 * @param raw 配置数组里的一行
 */
function toValueRule(raw: unknown): ValueRule | null {
  const row = readRecord(raw)
  const op = THRESHOLD_OPS.find((item) => item === row.op)
  if (op === undefined) return null
  const value = readLooseNumber(row.value)
  if (value === null) return null
  return {
    op,
    value,
    value2: readLooseNumber(row.value2),
    level: readEnum(row.level, THRESHOLD_LEVELS, 'warning'),
    color: readTrimmedText(row.color),
    label: readTrimmedText(row.label),
    blink: readBoolean(row.blink),
  }
}

/**
 * 把 `type: 'array'` 字段的原值规整成强类型规则表，脏行直接丢。
 * @param raw 配置里读出来的原值
 */
export function normalizeValueRules(raw: unknown): ValueRule[] {
  const rules: ValueRule[] = []
  for (const row of readArray(raw)) {
    const rule = toValueRule(row)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

/**
 * 逐条求值，取声明序里的首个命中。
 * ⚠ 一条一条地调求值器而不是自己重写匹配：区间档缺上界判不中、`normal` 档也算命中、
 * 声明序取首个这三条口径因此只有一份真源。规则数 ≤8，多调几次的代价可以忽略。
 * ⚠ 高危规则必须排在预警之前：顺序反了会让「两档都超」判成预警，最严重的那一档被吃掉。
 * @param value 实时值；缺值与非数一律不命中
 * @param rules 已经过 `normalizeValueRules` 规整的规则
 */
export function evaluateValueRules(
  value: unknown,
  rules: readonly ValueRule[],
): ValueHit | null {
  for (const rule of rules) {
    const hit = evaluateThresholds(value, [toThresholdRule(rule)])
    if (hit === null) continue
    return {
      level: hit.level,
      color: rule.color === '' ? hit.color : rule.color,
      label: rule.label,
      blink: hit.blink,
    }
  }
  return null
}

/**
 * 生成「值规则」配置字段，清单直接铺进自己的 `configSchema`。
 * ⚠ 颜色只填 `var(--…)` 引用，不填十六进制：算出来的色值会原地钉死在一套配色上，
 * 换肤时不跟着走。
 * @param key 字段键
 * @param label 字段标签
 * @param help 标签旁的说明
 */
export function valueRulesField(
  key = 'rules',
  label = '值规则',
  help = '按声明顺序取首个命中，高危规则放前面；颜色留空跟随严重度语义色，填则只填 var(--…)。',
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
      {
        key: 'color',
        label: '颜色',
        type: 'color',
        default: '',
        help: '留空跟随严重度语义色；量程分区、介质类别这类非严重度的配色填这里。',
      },
      { key: 'label', label: '文案', type: 'string', default: '' },
      { key: 'blink', label: '闪烁', type: 'boolean', default: false },
    ],
    itemLabelKey: 'label',
    default: [],
  }
}
