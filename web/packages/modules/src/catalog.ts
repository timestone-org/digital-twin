/**
 * @fileoverview 模块清单 → 服务端目录（`module_types.json`）的构建期序列化。
 * 清单的唯一真源在前端（渲染组件与它同处一地才不会漂），服务端那份是本文件的
 * 产物：Agent 生成大屏读它、服务端校验 `field_key` 也读它（ADR-0012 五）。
 * ⚠ 只序列化与渲染无关的那部分——`component` / `preview` / `configPresets` /
 * `defaultConfig` 是编辑器与画布的事，服务端读了也没有用处。
 */
import type {
  BindingSpec,
  ConfigField,
  ModuleManifest,
  ModuleDefaultSize,
} from '@dt/contracts'

/** 服务端目录的格式版本，与 `ModuleCatalogOut.catalog_version` 同源。 */
export const MODULE_CATALOG_VERSION = 1

/** 序列化后的一层 JSON；键是 snake_case，与服务端 pydantic 模型逐字对应。 */
export type CatalogJson = { [key: string]: CatalogValue }
type CatalogValue =
  string | number | boolean | null | CatalogValue[] | CatalogJson

/**
 * 只放进有值的键。
 * ⚠ 不许把缺席写成 `null`：服务端的可选字段缺省就是「没有」，
 * 显式 null 与缺席在 pydantic 里是同一结果，但会让两份 JSON 的 diff 全是噪声。
 */
function put(
  into: CatalogJson,
  key: string,
  value: CatalogValue | undefined,
): void {
  if (value !== undefined) into[key] = value
}

function size(value: ModuleDefaultSize): CatalogJson {
  const out: CatalogJson = { width: value.width, height: value.height }
  put(out, 'min_width', value.minWidth)
  put(out, 'min_height', value.minHeight)
  return out
}

function options(field: ConfigField): CatalogValue[] | undefined {
  return field.options?.map((option) => ({
    // ⚠ 选项值是任意 JSON：布尔与数字都出现过，不许在这里 String() 掉
    value: (option.value ?? null) as CatalogValue,
    label: option.label,
  }))
}

function when(field: ConfigField): CatalogJson | undefined {
  const condition = field.when
  if (condition === undefined) return undefined
  return { key: condition.key, in: condition.in as CatalogValue[] }
}

function configField(field: ConfigField): CatalogJson {
  const out: CatalogJson = {
    key: field.key,
    label: field.label,
    type: field.type,
  }
  put(out, 'default', field.default as CatalogValue | undefined)
  put(out, 'options', options(field))
  put(out, 'placeholder', field.placeholder)
  put(out, 'group', field.group)
  put(out, 'help', field.help)
  put(out, 'span', field.span)
  put(out, 'when', when(field))
  put(out, 'min', field.min)
  put(out, 'max', field.max)
  put(out, 'step', field.step)
  put(out, 'item_schema', field.itemSchema?.map(configField))
  put(out, 'item_label_key', field.itemLabelKey)
  put(out, 'min_items', field.minItems)
  put(out, 'max_items', field.maxItems)
  put(out, 'fields', field.fields?.map(configField))
  return out
}

function bindingSpec(spec: BindingSpec): CatalogJson {
  const out: CatalogJson = {
    key: spec.key,
    label: spec.label,
    data_type: spec.dataType,
  }
  put(out, 'is_required', spec.isRequired)
  put(out, 'enum_map', spec.enumMap)
  put(out, 'is_array', spec.isArray)
  // ⚠ 这一项必须导出：服务端据它决定要不要对这个槽套「索引连续且从 0 起」，
  // 漏了的话行钉在实体上的槽会被当成列表式，只绑第 2 个实体就存不下去
  put(out, 'is_entity_pinned', spec.isEntityPinned)
  put(out, 'array_fields', spec.arrayFields?.map(bindingSpec))
  put(out, 'is_time_series', spec.isTimeSeries)
  return out
}

function moduleType(manifest: ModuleManifest): CatalogJson {
  const out: CatalogJson = {
    type: manifest.type,
    display_name: manifest.displayName,
    category: manifest.category,
  }
  put(out, 'icon', manifest.icon)
  put(out, 'keywords', manifest.keywords)
  out.default_size = size(manifest.defaultSize)
  out.chrome = manifest.chrome ?? 'card'
  put(out, 'is_container', manifest.isContainer)
  put(out, 'region', manifest.region)
  out.version = manifest.version ?? 1
  out.config_schema = manifest.configSchema.map(configField)
  out.bindings = manifest.bindings.map(bindingSpec)
  return out
}

/**
 * 把注册表里的模块清单序列化成服务端目录。
 * ⚠ 按 `type` 排序：注册顺序变了不该让产物跟着变，否则每次都是一份假 diff。
 * @param modules 已注册的全部模块清单
 */
export function buildModuleCatalog(
  modules: readonly ModuleManifest[],
): CatalogJson {
  const sorted = [...modules].sort((a, b) => (a.type < b.type ? -1 : 1))
  return {
    catalog_version: MODULE_CATALOG_VERSION,
    modules: sorted.map(moduleType),
  }
}
