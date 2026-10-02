/** @fileoverview 二维孪生草稿的分页读取、校验修改与诊断，写入复用文档撤销栈。 */
import type { AssistantToolCall } from '@dt/contracts'
import type { Twin2dConfig, Twin2dIssue } from '@dt/twin2d'

import type { SurfaceSnapshot } from '@/features/ai/surfaces'

import type { Twin2dSurfaceDeps } from './aiSurfaceTypes'
import { twin2dScan } from './twin2dIssues'

export const TWIN_2D_CONFIG_TOOLS = [
  'twin2d.read_config',
  'twin2d.patch_config',
  'twin2d.diagnose',
] as const

const ENTITY_SECTIONS = [
  'nodes',
  'edges',
  'marks',
  'styles',
  'edgeStyles',
] as const
type EntitySection = (typeof ENTITY_SECTIONS)[number]
type Section = 'canvas' | EntitySection
const MAX_ITEMS = 20

/** 执行二维配置工具，不属于本组时返回 null。 */
export function runTwin2dConfigTool(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (!TWIN_2D_CONFIG_TOOLS.some((name) => name === call.name)) return null
  const config = deps.config()
  if (config === null) throw new Error('二维孪生配置还没读出来')
  if (call.name === 'twin2d.read_config') return readConfig(config, call)
  if (call.name === 'twin2d.patch_config')
    return patchConfig(deps, config, call)
  const { issues } = twin2dScan(config)
  return { issue_count: issues.length, issues }
}

function readConfig(
  config: Twin2dConfig,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const section = sectionArg(call)
  const id = optionalText(call, 'id')
  if (section === 'canvas' || id !== undefined)
    return {
      section,
      ...(id ? { id } : {}),
      config: targetOf(config, section, id),
    }
  const keyword =
    optionalText(call, 'keyword')?.trim().toLocaleLowerCase() ?? ''
  const page = integerArg(call, 'page', 1, Number.MAX_SAFE_INTEGER)
  const limit = integerArg(call, 'limit', MAX_ITEMS, MAX_ITEMS)
  const items = config[section]
    .map((item) => ({
      id: item.id,
      name: nameOf(item),
    }))
    .filter((item) =>
      `${item.id} ${item.name}`.toLocaleLowerCase().includes(keyword),
    )
  const offset = (page - 1) * limit
  const hasMore = offset + limit < items.length
  return {
    section,
    items: items.slice(offset, offset + limit),
    page,
    limit,
    total: items.length,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
    is_truncated: hasMore,
  }
}

function patchConfig(
  deps: Twin2dSurfaceDeps,
  config: Twin2dConfig,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const section = sectionArg(call)
  const id = optionalText(call, 'id')
  const patch = call.arguments['patch']
  if (!isRecord(patch) || Object.keys(patch).length === 0)
    throw new Error('patch 必须是非空对象')
  if ('id' in patch) throw new Error('实体 id 不可修改')
  const current = targetOf(config, section, id)
  const merged = deepMerge(current, patch, 'patch')
  const candidate =
    section === 'canvas'
      ? { ...config, canvas: merged }
      : {
          ...config,
          [section]: config[section].map((item) =>
            item.id === id ? merged : item,
          ),
        }
  const scanned = validatedScan(config, candidate)
  const normalized = targetOf(scanned.live, section, id)
  requirePreservedValues(normalized, patch, 'patch')
  const changed = JSON.stringify(normalized) !== JSON.stringify(current)
  if (changed) deps.patchConfig(scanned.live)
  return {
    ok: true,
    changed,
    section,
    ...(id ? { id } : {}),
    config: normalized,
    is_saved: false,
    issues: scanned.issues,
    note: '已修改可撤销草稿，尚未保存；请核对实际配置与诊断。',
  }
}

function validatedScan(config: Twin2dConfig, candidate: unknown) {
  const scanned = twin2dScan(candidate)
  const existing = new Set(twin2dScan(config).issues.map(issueKey))
  const introduced = scanned.issues.filter(
    (issue) =>
      !existing.has(issueKey(issue)) &&
      (issue.level === 'error' ||
        issue.code.startsWith('dropped-') ||
        issue.code === 'prim-too-deep'),
  )
  if (introduced.length > 0)
    throw new Error(
      `修改未应用：${introduced.map((issue) => `${issue.at}：${issue.message}`).join('；')}`,
    )
  return scanned
}

function targetOf(
  config: Twin2dConfig,
  section: Section,
  id: string | undefined,
): Record<string, unknown> {
  if (section === 'canvas') {
    if (id !== undefined) throw new Error('canvas 是单例配置，不接收 id')
    return Object.fromEntries(Object.entries(config.canvas))
  }
  if (id === undefined) throw new Error(`${section} 修改时必须给实体 id`)
  const found = config[section].find((item) => item.id === id)
  if (found === undefined) throw new Error(`${section} 里找不到 ${id}`)
  return Object.fromEntries(Object.entries(found))
}

function nameOf(item: object): string {
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(item))
  for (const key of ['name', 'label', 'text', 'id']) {
    const value = body[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

function deepMerge(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(current, key))
      throw new Error(`${path}.${key} 不是可配置字段`)
    const before = current[key]
    requireValueType(before, value, `${path}.${key}`)
    next[key] =
      isRecord(before) && isRecord(value)
        ? deepMerge(before, value, `${path}.${key}`)
        : value
  }
  return next
}

function requireValueType(before: unknown, value: unknown, path: string): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error(`${path} 必须是有限数字`)
  if (before === null && (value === null || typeof value === 'number')) return
  const sameShape = Array.isArray(before)
    ? Array.isArray(value)
    : isRecord(before)
      ? isRecord(value)
      : typeof before === typeof value
  if (!sameShape) throw new Error(`${path} 的值类型不符`)
}

function requirePreservedValues(
  normalized: Record<string, unknown>,
  patch: Record<string, unknown>,
  path: string,
): void {
  for (const [key, value] of Object.entries(patch)) {
    const actual = normalized[key]
    if (isRecord(value) && isRecord(actual)) {
      requirePreservedValues(actual, value, `${path}.${key}`)
    } else if (JSON.stringify(actual) !== JSON.stringify(value)) {
      throw new Error(
        `${path}.${key} 无效；归一化会改为 ${JSON.stringify(actual)}，请使用合法配置值`,
      )
    }
  }
}

function sectionArg(call: AssistantToolCall): Section {
  const given = call.arguments['section']
  if (given === 'canvas') return given
  const section = ENTITY_SECTIONS.find((one) => one === given)
  if (section === undefined)
    throw new Error('section 必须是 canvas/nodes/edges/marks/styles/edgeStyles')
  return section
}

function optionalText(
  call: AssistantToolCall,
  key: string,
): string | undefined {
  const value = call.arguments[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '')
    throw new Error(`${key} 必须是非空文本`)
  return value
}

function integerArg(
  call: AssistantToolCall,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const value = call.arguments[key] ?? fallback
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new Error(`${key} 必须是 1 到 ${String(maximum)} 的整数`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function issueKey(issue: Twin2dIssue): string {
  return `${issue.code}:${issue.at}:${issue.message}`
}
