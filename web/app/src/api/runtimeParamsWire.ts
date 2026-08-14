/**
 * @fileoverview 运行参数出参的线形与它到载荷的映射。
 */
import type { RuntimeParamItem, RuntimeParamSection } from '@dt/contracts'
import { RUNTIME_PARAM_SECTIONS } from '@dt/contracts'

import { TransportError } from './client'

export interface RuntimeParamItemWire {
  section: string
  key: string
  env_name: string
  label: string
  value: unknown
  default: unknown
  overridden: boolean
  updated_by: string | null
  updated_at: string | null
  previous_value: unknown
}

/**
 * 窄化 section。
 * ⚠ 认不出就抛：section 是闭合集合，冒出第二种值意味着前后端的目录漂了，
 * 把它当成已知的某一段处理会让用户在错的页面上改错的旋钮。
 * @param raw 线上的 section
 */
function toSection(raw: unknown): RuntimeParamSection {
  const found = RUNTIME_PARAM_SECTIONS.find((section) => section === raw)
  if (found === undefined) {
    throw new TransportError(0, `未知的运行参数分组：${String(raw)}`)
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
    section: toSection(wire.section),
    key: wire.key,
    envName: wire.env_name,
    label: wire.label,
    value: wire.value,
    defaultValue: wire.default,
    overridden: wire.overridden,
    updatedBy: wire.updated_by,
    updatedAt: wire.updated_at,
    previousValue: wire.previous_value,
  }
}
