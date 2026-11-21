/** @fileoverview 平台来源表单的既有配置与实际变动字段。 */
import type { KnowledgeSourceMetadataPatch } from '@dt/contracts'
import type { KnowledgeSource, PlatformSourceConfig } from '@/api/knowledge'

const FIELDS = [
  'path',
  'id_field',
  'title_field',
  'page_param',
  'size_param',
] as const
const DEFAULTS: PlatformSourceConfig = {
  path: '',
  id_field: 'row_id',
  title_field: '',
  page_param: 'page',
  size_param: 'size',
}

/** 来源管理能力仅在支持编辑、解绑的服务版本中存在。
 * @param source 当前来源
 */
export function supportsSourceManagement(source: KnowledgeSource): boolean {
  return source.kind === 'platform' && source.canChangeIdentity !== undefined
}

/** 读取当前配置，兼容只持久化非默认字段的来源。
 * @param source 正在编辑的来源
 */
export function sourceConfig(source?: KnowledgeSource): PlatformSourceConfig {
  const values = { ...DEFAULTS }
  for (const key of FIELDS) {
    const stored = source?.config[key]
    if (typeof stored === 'string' && stored !== '') values[key] = stored
  }
  return values
}

/** 只发送用户修改的字段。
 * @param source 原来源
 * @param name 名称
 * @param config 编辑后的配置
 */
export function sourcePatch(
  source: KnowledgeSource,
  name: string,
  config: PlatformSourceConfig,
): KnowledgeSourceMetadataPatch {
  const result: KnowledgeSourceMetadataPatch = {}
  if (name !== source.name) result.name = name
  const baseline = sourceConfig(source)
  const changes: Partial<PlatformSourceConfig> = {}
  for (const key of FIELDS) {
    if (config[key] !== baseline[key]) changes[key] = config[key]
  }
  if (Object.keys(changes).length > 0) result.config = changes
  return result
}
