/**
 * @fileoverview 模块清单 → 服务端目录（`module_types.json`）的构建期序列化。
 * 清单的唯一真源在前端（渲染组件与它同处一地才不会漂），服务端那份是本文件的
 * 产物：Agent 生成大屏读它、服务端校验 `field_key` 也读它（ADR-0012 五）。
 * ⚠ 只序列化与渲染无关的那部分：`component` 与 `preview` 是画布的事，
 * `unsupportedChromeKeys` / `interactionEvents` 是属性面板的适配声明——
 * 服务端与模型都没有消费点，序列化它们只会平添一段要跨仓同步的 diff。
 * ⚠ `configPresets` / `defaultConfig` / `subEditor` 反过来**必须**导出：
 * 它们回答的是「这个模块该怎么配」，而模型只有这一份目录可读。少了预设，
 * 模型只能逐个字段去凑一套观感（十几个键，漏一个也看不出漏在哪）；少了
 * `subEditor`，它会照着猜往子编辑器那一段里写，而写进去既不报错也不渲染。
 */
import type {
  BindingSpec,
  ConfigField,
  ConfigPreset,
  ModuleManifest,
  ModuleDefaultSize,
  ModuleSubEditor,
} from '@dt/contracts'
import { BINDING_DATA_TYPE_DOCS, CONFIG_FIELD_TYPE_DOCS } from '@dt/contracts'

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
  // ⚠ 条件取值是任意 JSON：布尔与数字都出现过，不许在这里 String() 掉
  return { key: condition.key, in: condition.in as CatalogValue[] }
}

function configField(field: ConfigField): CatalogJson {
  const out: CatalogJson = {
    key: field.key,
    label: field.label,
    type: field.type,
  }
  // ⚠ 缺省值是任意 JSON：布尔与数字都出现过，不许在这里 String() 掉
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

/**
 * 预设里那一袋任意 JSON。
 * ⚠ 不做任何收窄：预设可以写 schema 之外的段（`__cardStyle` 就是），
 * 按 `ConfigField` 的形状去过滤会把它们整段吃掉，而吃掉之后模型套上预设
 * 得到的是半套观感，且两侧都不报错。
 */
function freeJson(value: unknown): CatalogValue {
  return value as CatalogValue
}

function configPreset(preset: ConfigPreset): CatalogJson {
  const out: CatalogJson = { id: preset.id, label: preset.label }
  put(out, 'hint', preset.hint)
  out.config = freeJson(preset.config)
  return out
}

function subEditor(editor: ModuleSubEditor): CatalogJson {
  const out: CatalogJson = {
    config_key: editor.configKey,
    route_name: editor.routeName,
    label: editor.label,
  }
  put(out, 'hint', editor.hint)
  return out
}

function moduleType(manifest: ModuleManifest): CatalogJson {
  const out: CatalogJson = {
    type: manifest.type,
    display_name: manifest.displayName,
    category: manifest.category,
  }
  // 模型据它选模块、配字段；缺席只有第三方清单才允许（ModuleManifest.description）
  put(out, 'description', manifest.description)
  put(out, 'icon', manifest.icon)
  put(out, 'keywords', manifest.keywords)
  out.default_size = size(manifest.defaultSize)
  out.chrome = manifest.chrome ?? 'card'
  put(out, 'is_container', manifest.isContainer)
  put(out, 'region', manifest.region)
  out.version = manifest.version ?? 1
  out.config_schema = manifest.configSchema.map(configField)
  out.bindings = manifest.bindings.map(bindingSpec)
  // 一次写一整套观感的按钮。模型逐个字段去凑同样的效果时，漏一个也看不出漏在哪
  put(out, 'config_presets', manifest.configPresets?.map(configPreset))
  // 新建节点时**显式落库**的出厂配置，与 `ConfigField.default` 的不落库兜底不是一回事
  put(
    out,
    'default_config',
    manifest.defaultConfig === undefined
      ? undefined
      : freeJson(manifest.defaultConfig),
  )
  // 这一段配置由整页子编辑器接管：模型照猜着往里写，既不报错也不渲染
  put(
    out,
    'sub_editor',
    manifest.subEditor === undefined
      ? undefined
      : subEditor(manifest.subEditor),
  )
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
    // ⚠ 摆在模块表**之前**：这两张表是读下面那些 `type` / `data_type` 的图例，
    //   放在末尾的话，被上下文截断时先没的正是图例
    field_types: docTable(CONFIG_FIELD_TYPE_DOCS),
    binding_data_types: docTable(BINDING_DATA_TYPE_DOCS),
    modules: sorted.map(moduleType),
  }
}

/**
 * 把「档位 → 一句话」的说明表摊成有序数组。
 * ⚠ 用数组不用对象：JSON 对象的键序在跨语言往返里没有保证，而这份产物是
 * 逐字比对的快照——键序一漂，每次生成都是一份假 diff。
 * @param docs 契约里逐档铺满的说明表
 */
function docTable(docs: Readonly<Record<string, string>>): CatalogValue[] {
  return Object.entries(docs)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([type, doc]) => ({ type, doc }))
}
