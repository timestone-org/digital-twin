/** @fileoverview 把模型签名里的一步后处理折成一句人话。 */
import type { ModelingSignaturePostprocess } from '@dt/contracts'

const COMPARE_LABELS: Readonly<Record<string, string>> = {
  lt: '小于',
  lte: '小于等于',
  gt: '大于',
  gte: '大于等于',
  eq: '等于',
  ne: '不等于',
}
const ROUND_LABELS: Readonly<Record<string, string>> = {
  nearest: '四舍五入',
  floor: '向下取整',
  ceil: '向上取整',
}

function textOf(value: unknown): string {
  return typeof value === 'number' ? String(value) : '空'
}

/** 算子参数落成的那句规则；不认识的算子只显示名字。Args: item。 */
export function postprocessText(item: ModelingSignaturePostprocess): string {
  const { config, label, operator } = item
  if (operator === 'clamp_prediction') {
    return `${label}：下限 ${textOf(config['lower'])}，上限 ${textOf(config['upper'])}`
  }
  if (operator === 'replace_prediction') {
    const compare = COMPARE_LABELS[String(config['op'])] ?? '满足条件'
    return `${label}：${compare} ${textOf(config['threshold'])} 时取 ${textOf(config['value'])}`
  }
  if (operator === 'round_prediction') {
    const mode = ROUND_LABELS[String(config['mode'])] ?? '取整'
    return `${label}：保留 ${textOf(config['decimals'])} 位小数，${mode}`
  }
  return label
}
