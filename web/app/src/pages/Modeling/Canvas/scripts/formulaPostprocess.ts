/** @fileoverview 预测后处理三个算子的公式骨架。 */
import { cases, nameOf, numOf, opOf, run, varOf } from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import { NO_CONFIG, numberAt, textAt } from './formulaArgs'

const COMPARE_SYMBOLS: Readonly<Record<string, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
  ne: '≠',
}
const ROUND_LABELS: Readonly<Record<string, string>> = {
  nearest: '四舍五入',
  floor: '向下取整',
  ceil: '向上取整',
}
const SHARED_NOTE = '发布后线上预测走同一步：模型算出的数改完才交给调用方。'
const EVALUATE_NOTE =
  '评估接在这一步之后，指标才是处理后的预测值；接在模型上算的是原始预测值。'

function clampRule(context: FormulaContext): FormulaSpec {
  const lower = numberAt(context.config, 'lower')
  const upper = numberAt(context.config, 'upper')
  const hasBound = lower !== null || upper !== null
  return {
    id: 'clamp',
    title: '预测值怎么夹进区间',
    symbolic: [
      cases([
        { when: 'ŷ < lo', then: [run(varOf('lo'))] },
        { when: 'ŷ > hi', then: [run(varOf('hi'))] },
        { when: '其余', then: [run(varOf('ŷ'))] },
      ]),
    ],
    filled: hasBound
      ? [
          run(
            varOf('[lo, hi]'),
            opOf('='),
            lower === null ? nameOf('不设下限') : numOf(lower),
            opOf(','),
            upper === null ? nameOf('不设上限') : numOf(upper),
          ),
        ]
      : null,
    fallback: hasBound ? null : NO_CONFIG,
    isOpen: false,
    legend: [{ symbol: 'ŷ', text: '模型算出的预测值' }],
    notes: [SHARED_NOTE, EVALUATE_NOTE],
  }
}

function replaceRule(context: FormulaContext): FormulaSpec {
  const threshold = numberAt(context.config, 'threshold')
  const value = numberAt(context.config, 'value')
  const symbol = COMPARE_SYMBOLS[textAt(context.config, 'op')]
  const isKnown = threshold !== null && value !== null && symbol !== undefined
  return {
    id: 'replace',
    title: '什么时候换成给定的数',
    symbolic: [
      cases([
        { when: 'ŷ ⋄ t', then: [run(varOf('v'))] },
        { when: '其余', then: [run(varOf('ŷ'))] },
      ]),
    ],
    filled: isKnown
      ? [
          run(
            nameOf('当'),
            varOf('ŷ'),
            opOf(symbol),
            numOf(threshold),
            nameOf('时取'),
            numOf(value),
          ),
        ]
      : null,
    fallback: isKnown ? null : NO_CONFIG,
    isOpen: false,
    legend: [
      { symbol: 'ŷ', text: '模型算出的预测值' },
      { symbol: '⋄', text: '配置里选的比较方式' },
      { symbol: 't / v', text: '比较值与替换成的数' },
    ],
    notes: [SHARED_NOTE, EVALUATE_NOTE],
  }
}

function roundRule(context: FormulaContext): FormulaSpec {
  const decimals = numberAt(context.config, 'decimals')
  const label = ROUND_LABELS[textAt(context.config, 'mode')]
  const isKnown = decimals !== null && label !== undefined
  return {
    id: 'round',
    title: '保留几位小数',
    symbolic: [run(varOf('y'), opOf('='), varOf('round(ŷ, d)'))],
    filled: isKnown
      ? [run(nameOf('保留'), numOf(decimals), nameOf(`位小数，${label}`))]
      : null,
    fallback: isKnown ? null : NO_CONFIG,
    isOpen: false,
    legend: [
      { symbol: 'ŷ', text: '模型算出的预测值' },
      { symbol: 'd', text: '配置里的小数位数' },
    ],
    notes: [
      SHARED_NOTE,
      '按十进制取整：2.5 四舍五入得 3，不是银行家舍入的 2。',
    ],
  }
}

export const POSTPROCESS_FORMULAS = {
  clamp_prediction: [clampRule],
  replace_prediction: [replaceRule],
  round_prediction: [roundRule],
} as const
