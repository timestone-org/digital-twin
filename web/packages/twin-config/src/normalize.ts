/**
 * @fileoverview 任意来源的 JSON → 合法 `TwinConfig`。渲染层与编辑器的唯一入口。
 */
import { TWIN_CONFIG_VERSION } from './constants'
import {
  normalizeCamera,
  normalizeModel,
  normalizeViewpoints,
} from './normalizeScene'
import {
  normalizeArrow,
  normalizeFlow,
  normalizePanel,
} from './normalizeElements'
import {
  normalizeClickDistance,
  normalizeVisibility,
} from './normalizeRules'
import { clampedOr, entityId, normalizeList, vec3, ORIGIN } from './normalizeShared'
import { isRecord, stringList, toFiniteNumber, trimmedString } from './sanitize'
import type { TwinAnchor, TwinConfig, TwinPart } from './types'

const MAX_DECIMALS = 10

function normalizePart(raw: unknown, index: number): TwinPart | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'part', index),
    name: trimmedString(raw.name),
    nodes: stringList(raw.nodes),
    visibility: normalizeVisibility(raw.visibility, raw.visible),
    clickDistance: normalizeClickDistance(raw.clickDistance),
  }
}

function normalizeAnchor(raw: unknown, index: number): TwinAnchor | null {
  if (!isRecord(raw)) return null
  const decimals = toFiniteNumber(raw.decimals)
  return {
    id: entityId(raw.id, 'anchor', index),
    name: trimmedString(raw.name),
    position: vec3(raw.position, ORIGIN),
    label: trimmedString(raw.label),
    unit: trimmedString(raw.unit),
    decimals:
      decimals === null
        ? null
        : clampedOr(Math.round(decimals), 0, 0, MAX_DECIMALS),
    visibility: normalizeVisibility(raw.visibility, raw.visible),
  }
}

/**
 * 任意来源的 JSON → 合法 TwinConfig。
 * ⚠ 幂等：`normalizeTwinConfig(normalizeTwinConfig(x))` 与一次的结果逐字段相同——
 * 铸 id 只用下标、颜色与数字的归一都收敛，且输出里没有 `undefined`（JSON 往返也不变形）。
 * 数组绑定行的文档序对齐口径以它的输出为准。
 * @param raw 落库的配置块
 */
export function normalizeTwinConfig(raw: unknown): TwinConfig {
  const source = isRecord(raw) ? raw : {}
  return {
    version: TWIN_CONFIG_VERSION,
    model: normalizeModel(source.model),
    parts: normalizeList(source.parts, normalizePart),
    anchors: normalizeList(source.anchors, normalizeAnchor),
    cameras: normalizeList(source.cameras, normalizeCamera),
    viewpoints: normalizeViewpoints(source.viewpoints),
    panels: normalizeList(source.panels, normalizePanel),
    arrows: normalizeList(source.arrows, normalizeArrow),
    flows: normalizeList(source.flows, normalizeFlow),
  }
}
