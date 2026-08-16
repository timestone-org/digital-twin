/**
 * @fileoverview 运行参数出参的线形与它到载荷的映射。
 *
 * ⚠ 线形字段名以 `openapi.json` 的 `RuntimeParamOut` 为准（default_value /
 * is_overridden）：此前这里写的是 `default` / `overridden`，与后端从未一致，
 * 表现是弹窗里默认值恒空、「已覆盖」徽标永远不亮，而 typecheck 与单测全绿。
 */
import type {
  RuntimeParamDanger,
  RuntimeParamItem,
  RuntimeParamKind,
  RuntimeParamSection,
  RuntimeParamTier,
} from '@dt/contracts'
import {
  RUNTIME_PARAM_DANGERS,
  RUNTIME_PARAM_KINDS,
  RUNTIME_PARAM_SECTIONS,
  RUNTIME_PARAM_TIERS,
} from '@dt/contracts'

import { TransportError } from './client'

export interface RuntimeParamItemWire {
  section: string
  key: string
  env_name: string
  write_code: string
  label: string
  hint: string
  kind: string
  unit: string
  step: number
  minimum: number
  maximum: number
  tier: string
  danger: string | null
  value: number | boolean
  default_value: number | boolean
  previous_value: number | boolean | null
  is_overridden: boolean
  updated_by: string | null
  updated_at: string | null
}

/**
 * 从闭合集合里认出一个值。
 * ⚠ 认不出就抛：冒出第二种值意味着前后端的目录漂了，把它当成已知的某一段
 * 处理会让用户在错的页面上改错的旋钮。
 * @param raw 线上的值
 * @param known 闭合集合
 * @param what 报错时说人话用
 */
function narrowed<ValueT extends string>(
  raw: unknown,
  known: readonly ValueT[],
  what: string,
): ValueT {
  const found = known.find((candidate) => candidate === raw)
  if (found === undefined) {
    throw new TransportError(0, `未知的${what}：${String(raw)}`)
  }
  return found
}

/**
 * 一个运行参数项的载荷。
 * @param wire 线上的参数项
 */
export function toRuntimeParamItem(
  wire: RuntimeParamItemWire,
): RuntimeParamItem {
  return {
    section: narrowed<RuntimeParamSection>(
      wire.section,
      RUNTIME_PARAM_SECTIONS,
      '运行参数分组',
    ),
    key: wire.key,
    envName: wire.env_name,
    writeCode: wire.write_code,
    label: wire.label,
    hint: wire.hint,
    kind: narrowed<RuntimeParamKind>(
      wire.kind,
      RUNTIME_PARAM_KINDS,
      '运行参数控件类型',
    ),
    unit: wire.unit,
    step: wire.step,
    minimum: wire.minimum,
    maximum: wire.maximum,
    tier: narrowed<RuntimeParamTier>(
      wire.tier,
      RUNTIME_PARAM_TIERS,
      '运行参数生效档位',
    ),
    danger:
      wire.danger === null
        ? null
        : narrowed<RuntimeParamDanger>(
            wire.danger,
            RUNTIME_PARAM_DANGERS,
            '运行参数危险方向',
          ),
    value: wire.value,
    defaultValue: wire.default_value,
    overridden: wire.is_overridden,
    updatedBy: wire.updated_by,
    updatedAt: wire.updated_at,
    previousValue: wire.previous_value,
  }
}
