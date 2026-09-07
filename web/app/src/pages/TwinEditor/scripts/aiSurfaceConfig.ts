/** @fileoverview AI 对三维孪生各配置节的按需读取、深合并修改与诊断。 */
import {
  collectTwinConfigIssues,
  normalizeTwinConfig,
  type TwinConfig,
  type TwinOutlineFolder,
} from '@dt/twin-config'
import type { AssistantToolCall } from '@dt/contracts'

import type { SurfaceSnapshot } from '@/features/ai/surfaces'

import type { TwinSurfaceDeps } from './aiSurfaceTypes'
import type { TwinEntityKind } from './types'

export const TWIN_CONFIG_TOOLS = [
  'twin.read_config',
  'twin.patch_config',
  'twin.diagnose',
] as const

const MAX_LIST_ITEMS = 100
const ENTITY_SECTIONS = [
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
] as const

type TwinConfigSection = 'model' | 'viewpoints' | 'roam' | TwinEntityKind

/** 执行一条孪生配置工具；不属于本组时返回 null。 */
export function runTwinConfigTool(
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (call.name === 'twin.read_config') return readConfig(deps, call)
  if (call.name === 'twin.patch_config') return patchConfig(deps, call)
  if (call.name === 'twin.diagnose') return diagnose(deps)
  return null
}

function requireConfig(deps: TwinSurfaceDeps): TwinConfig {
  const config = deps.config()
  if (config === null) throw new Error('孪生配置还没读出来')
  return config
}

function readConfig(
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const config = requireConfig(deps)
  const section = sectionArg(call)
  const id = optionalText(call, 'id')
  const folderId = optionalText(call, 'folder_id')
  if (!isEntitySection(section)) {
    if (id !== undefined) throw new Error(`${section} 是单例配置，不接收 id`)
    if (folderId !== undefined)
      throw new Error(`${section} 是单例配置，不接收 folder_id`)
    return { section, config: singletonOf(config, section) }
  }
  const folders = foldersOf(config, section)
  if (id !== undefined) {
    if (folderId !== undefined) throw new Error('id 与 folder_id 不能同时使用')
    return {
      section,
      id,
      folder: folderOf(folders, id),
      config: entityOf(config, section, id),
    }
  }
  const selectedFolder = selectFolder(folders, section, folderId)
  const items =
    selectedFolder === null
      ? config[section]
      : config[section].filter((item) =>
          selectedFolder.itemIds.includes(item.id),
        )
  return {
    section,
    folders: folders.map((folder) => ({
      ...folderBriefOf(folder),
      item_count: folder.itemIds.length,
    })),
    items: items.slice(0, MAX_LIST_ITEMS).map((item) => ({
      id: item.id,
      name: item.name,
      folder: folderOf(folders, item.id),
    })),
    is_truncated: items.length > MAX_LIST_ITEMS,
  }
}

function foldersOf(
  config: TwinConfig,
  section: TwinEntityKind,
): TwinOutlineFolder[] {
  return config.folders.filter((folder) => folder.kind === section)
}

function selectFolder(
  folders: readonly TwinOutlineFolder[],
  section: TwinEntityKind,
  folderId: string | undefined,
): TwinOutlineFolder | null {
  if (folderId === undefined) return null
  const folder = folders.find((item) => item.id === folderId)
  if (folder === undefined)
    throw new Error(`${section} 里找不到文件夹 ${folderId}`)
  return folder
}

function folderBriefOf(folder: TwinOutlineFolder): {
  id: string
  name: string
} {
  return { id: folder.id, name: folder.name }
}

function folderOf(
  folders: readonly TwinOutlineFolder[],
  itemId: string,
): { id: string; name: string } | null {
  const folder = folders.find((item) => item.itemIds.includes(itemId))
  return folder === undefined ? null : folderBriefOf(folder)
}

function patchConfig(
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const config = requireConfig(deps)
  const section = sectionArg(call)
  const id = optionalText(call, 'id')
  const patch = recordArg(call, 'patch')
  if (Object.keys(patch).length === 0) throw new Error('patch 不能为空')
  if ('id' in patch) throw new Error('实体 id 不可修改')
  const current = targetOf(config, section, id)
  const merged = deepMerge(current, patch, 'patch')
  const next = normalizeTwinConfig(replaced(config, section, id, merged))
  const normalized = targetOf(next, section, id)
  const changed = JSON.stringify(normalized) !== JSON.stringify(current)
  if (changed) deps.patchConfig(next)
  return {
    ok: true,
    changed,
    section,
    ...(id ? { id } : {}),
    config: normalized,
  }
}

function diagnose(deps: TwinSurfaceDeps): SurfaceSnapshot {
  const issues = collectTwinConfigIssues(requireConfig(deps))
  return { issue_count: issues.length, issues }
}

function targetOf(
  config: TwinConfig,
  section: TwinConfigSection,
  id: string | undefined,
): Record<string, unknown> {
  if (!isEntitySection(section)) {
    if (id !== undefined) throw new Error(`${section} 是单例配置，不接收 id`)
    return recordOf(singletonOf(config, section))
  }
  if (id === undefined) throw new Error(`${section} 修改时必须给实体 id`)
  return recordOf(entityOf(config, section, id))
}

function singletonOf(
  config: TwinConfig,
  section: Exclude<TwinConfigSection, TwinEntityKind>,
): object {
  if (section === 'model') return config.model
  if (section === 'viewpoints') return config.viewpoints
  return config.roamTour
}

function entityOf(
  config: TwinConfig,
  section: TwinEntityKind,
  id: string,
): object {
  const found = config[section].find((item) => item.id === id)
  if (found === undefined) throw new Error(`${section} 里找不到 ${id}`)
  return found
}

function replaced(
  config: TwinConfig,
  section: TwinConfigSection,
  id: string | undefined,
  merged: Record<string, unknown>,
): unknown {
  if (!isEntitySection(section))
    return replaceSingleton(config, section, merged)
  if (id === undefined) throw new Error(`${section} 修改时必须给实体 id`)
  return {
    ...config,
    [section]: config[section].map((item) => (item.id === id ? merged : item)),
  }
}

function replaceSingleton(
  config: TwinConfig,
  section: Exclude<TwinConfigSection, TwinEntityKind>,
  merged: Record<string, unknown>,
): unknown {
  if (section === 'model') return { ...config, model: merged }
  if (section === 'viewpoints') return { ...config, viewpoints: merged }
  return { ...config, roamTour: merged }
}

function deepMerge(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current)) throw new Error(`${path}.${key} 不是可配置字段`)
    const before = current[key]
    next[key] =
      isRecord(before) && isRecord(value)
        ? deepMerge(before, value, `${path}.${key}`)
        : value
  }
  return next
}

function sectionArg(call: AssistantToolCall): TwinConfigSection {
  const value = call.arguments['section']
  if (
    value === 'model' ||
    value === 'viewpoints' ||
    value === 'roam' ||
    isEntitySection(value)
  )
    return value
  throw new Error(`${call.name} 的 section 无效`)
}

function isEntitySection(value: unknown): value is TwinEntityKind {
  return ENTITY_SECTIONS.some((section) => section === value)
}

function optionalText(
  call: AssistantToolCall,
  name: string,
): string | undefined {
  const value = call.arguments[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '')
    throw new Error(`${call.name} 的 ${name} 必须是非空文本`)
  return value
}

function recordArg(
  call: AssistantToolCall,
  name: string,
): Record<string, unknown> {
  const value = call.arguments[name]
  if (!isRecord(value)) throw new Error(`${call.name} 的 ${name} 必须是对象`)
  return value
}

function recordOf(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
