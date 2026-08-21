/**
 * @fileoverview 多选批量配置的纯逻辑：同类型判定、按类型统计、可见字段交集与
 * 混合值计算。面板只做渲染，判定全在这里，不碰 Vue 响应式。
 */
import type {
  ConfigField,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { resolveModuleConfig, type GetModuleManifest } from '@dt/runtime'

import { formGroups, isFieldVisible, type ConfigGroup } from './configForm'

/** 已选清单里同一模块类型的一组节点。 */
export interface ModuleTypeGroup {
  moduleType: string
  /** 清单里的显示名；清单缺失时退回类型 id 原文。 */
  displayName: string
  count: number
  ids: readonly string[]
}

/** 一个字段在批量表单里的状态；`value` 是主选中的 resolved 值。 */
export interface BatchFieldState {
  field: ConfigField
  value: unknown
  isMixed: boolean
}

/** 批量表单的一段：分组标题沿用属性面板的口径。 */
export interface BatchConfigGroup {
  title: string
  fields: readonly BatchFieldState[]
}

/** 选中集是否全为同一模块类型；空集不算。 */
export function isUniformType(nodes: readonly DashboardNodePayload[]): boolean {
  if (nodes.length === 0) return false
  return new Set(nodes.map((node) => node.moduleType)).size === 1
}

/**
 * 按模块类型统计选中集，序按首次出现。
 * @param nodes 选中的节点
 * @param getManifest 注入式清单解析器
 */
export function moduleTypeGroups(
  nodes: readonly DashboardNodePayload[],
  getManifest: GetModuleManifest,
): ModuleTypeGroup[] {
  const byType = new Map<string, string[]>()
  for (const node of nodes) {
    const bucket = byType.get(node.moduleType)
    if (bucket === undefined) byType.set(node.moduleType, [node.id])
    else bucket.push(node.id)
  }
  return [...byType.entries()].map(([moduleType, ids]) => ({
    moduleType,
    displayName: getManifest(moduleType)?.displayName ?? moduleType,
    count: ids.length,
    ids,
  }))
}

/** 这份配置下可见的字段键集。 */
function visibleKeys(
  schema: readonly ConfigField[],
  config: Record<string, unknown>,
): Set<string> {
  return new Set(
    schema
      .filter((field) => isFieldVisible(field, config))
      .map((field) => field.key),
  )
}

/** 每个节点上都可见的字段键。 */
function sharedVisibleKeys(
  nodes: readonly DashboardNodePayload[],
  manifest: ModuleManifest | undefined,
  schema: readonly ConfigField[],
): Set<string> {
  return nodes
    .map((node) =>
      visibleKeys(schema, resolveModuleConfig(manifest, node.configJson)),
    )
    .reduce((kept, keys) => new Set([...kept].filter((key) => keys.has(key))))
}

/**
 * 批量表单的可见字段：逐节点算 `when` 可见集后**取交集**，任一节点上不可见的
 * 字段不进批量表单；声明了子编辑器的字段是跳转入口，也不进。
 * @param nodes 选中的同类型节点
 * @param manifest 该类型的清单
 */
export function intersectFormGroups(
  nodes: readonly DashboardNodePayload[],
  manifest: ModuleManifest | undefined,
): ConfigGroup[] {
  const first = nodes[0]
  const schema = manifest?.configSchema ?? []
  if (first === undefined || schema.length === 0) return []
  const shared = sharedVisibleKeys(nodes, manifest, schema)
  const subEditorKey = manifest?.subEditor?.configKey
  return formGroups(schema, resolveModuleConfig(manifest, first.configJson))
    .map((group) => ({
      title: group.title,
      fields: group.fields.filter(
        (field) => shared.has(field.key) && field.key !== subEditorKey,
      ),
    }))
    .filter((group) => group.fields.length > 0)
}

/**
 * 逐字段算混合态：各节点的 resolved 值按 JSON 序列化深比较，不全等即混合。
 * @param nodes 选中的同类型节点
 * @param primary 主选中（选中集末位），`value` 取它的 resolved 值
 * @param manifest 该类型的清单
 * @param fields 参与批量的字段（先过 intersectFormGroups）
 */
export function batchFieldStates(
  nodes: readonly DashboardNodePayload[],
  primary: DashboardNodePayload | null,
  manifest: ModuleManifest | undefined,
  fields: readonly ConfigField[],
): BatchFieldState[] {
  const resolvedAll = nodes.map((node) =>
    resolveModuleConfig(manifest, node.configJson),
  )
  const base =
    primary === null
      ? resolvedAll[0]
      : resolveModuleConfig(manifest, primary.configJson)
  return fields.map((field) => {
    const mark = JSON.stringify(resolvedAll[0]?.[field.key])
    return {
      field,
      value: base?.[field.key],
      isMixed: resolvedAll.some(
        (resolved) => JSON.stringify(resolved[field.key]) !== mark,
      ),
    }
  })
}

/**
 * 交集 + 混合态合成的批量表单模型，面板一次拿全。
 * @param nodes 选中的同类型节点
 * @param primary 主选中（选中集末位）
 * @param manifest 该类型的清单
 */
export function batchConfigGroups(
  nodes: readonly DashboardNodePayload[],
  primary: DashboardNodePayload | null,
  manifest: ModuleManifest | undefined,
): BatchConfigGroup[] {
  return intersectFormGroups(nodes, manifest).map((group) => ({
    title: group.title,
    fields: batchFieldStates(nodes, primary, manifest, group.fields),
  }))
}
