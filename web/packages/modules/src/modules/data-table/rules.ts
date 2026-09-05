/**
 * @fileoverview data-table 的值规则：判据与颜色的口径整份复用 `shared/valueRules.ts`
 * （列表族与卡片族读的是同一份），这里只多一件事——每条规则挑一列。
 *
 * ⚠ 多挑这一列不是装饰：一张表里各列的量纲互不相干，同一条 `> 80` 套到所有列上
 * 就是给别的列乱上色，而上出来的色完全合法、没有任何报错。
 * ⚠ 规则行与列表行**一一对齐**地规整：脏行在这里被丢掉时，它挑的那一列也一起丢，
 * 不许出现「规则丢了、列号还在」而让后面每条规则改判前一条的列。
 */
import type { ConfigField } from '@dt/contracts'

import { readArray, readEnum, readRecord } from '../../shared/config'
import {
  evaluateValueRules,
  normalizeValueRules,
  valueRulesField,
  type ValueHit,
  type ValueRule,
} from '../../shared/valueRules'
import {
  TABLE_RULE_COLUMN_VALUES,
  TABLE_RULE_COLUMNS,
  type TableRuleColumn,
} from './options'

export type { ValueHit, ValueRule } from '../../shared/valueRules'

/** 值规则的配置键。 */
export const TABLE_RULES_KEY = 'rules'

/** 一条挑了列的值规则。`column` 空串 = 这条管全部列。 */
export interface TableRule {
  column: TableRuleColumn
  rule: ValueRule
}

/**
 * 把配置里的规则表规整成挑了列的规则；判不出运算符或阈值的那一行整条丢掉。
 * ⚠ 逐行单独过一次 `normalizeValueRules`，而不是先整表规整再配对列号：整表规整
 * 会把脏行滤掉、剩下的规则与原始行号错位，于是每条规则都改判了前一条挑的列。
 * @param raw `config.rules` 的原值
 */
export function normalizeTableRules(raw: unknown): TableRule[] {
  const rules: TableRule[] = []
  for (const row of readArray(raw)) {
    const [rule] = normalizeValueRules([row])
    if (rule === undefined) continue
    rules.push({
      column: readEnum(readRecord(row).column, TABLE_RULE_COLUMN_VALUES, ''),
      rule,
    })
  }
  return rules
}

/**
 * 这一格命中哪一条规则；按声明序取首个命中。
 * @param value 这一格的实时值；缺值与非数一律不命中
 * @param column 这一格所在的列键
 * @param rules 已经过 `normalizeTableRules` 规整的规则
 */
export function evaluateTableRules(
  value: unknown,
  column: string,
  rules: readonly TableRule[],
): ValueHit | null {
  const scoped = rules
    .filter((entry) => entry.column === '' || entry.column === column)
    .map((entry) => entry.rule)
  return evaluateValueRules(value, scoped)
}

/** 规则行最前面那一格：这条规则管哪一列。 */
const COLUMN_FIELD: ConfigField = {
  key: 'column',
  label: '管哪一列',
  type: 'enum',
  default: '',
  options: [...TABLE_RULE_COLUMNS],
  help: '这条规则只判这一列的读数。选「全部列」要当心：各列量纲不同，同一个阈值套到别的列上会给出完全合法却毫无意义的颜色。',
}

/**
 * 在一份规则字段的 `itemSchema` 最前面插「管哪一列」。
 * ⚠ 插在最前面是有意的：规则行在属性面板上折叠成一行，先看见管哪列才读得懂
 * 后面的判据。
 * @param base 共用那一份的规则字段
 */
export function withColumnPicker(base: ConfigField): ConfigField {
  const rest = base.itemSchema
  return {
    ...base,
    itemSchema: rest === undefined ? [COLUMN_FIELD] : [COLUMN_FIELD, ...rest],
  }
}

/** 「值规则」配置字段：共用那一份，再插一格「管哪一列」。 */
export function tableRulesField(): ConfigField {
  return withColumnPicker(
    valueRulesField(
      TABLE_RULES_KEY,
      '值规则',
      '按声明顺序取首个命中，高危规则放前面；颜色留空跟随严重度语义色，填则只填 var(--…)。⚠ 规则只给单元格文字上色，不改单位与小数位。',
    ),
  )
}
