/**
 * @fileoverview 配置那一半的客户端工具：读当前配置、往数组字段里加减项、
 * 交出卡片外观的键词汇表。
 *
 * ⚠ **读得到才写得对。** 配置是一只自由袋子，模块清单只说得出「有哪些键」，
 * 说不出「这个画布节点此刻配成什么样」。没有读的那一步，助手往 `items` 里
 * 加一个指标只能整份重写——而重写会把用户已经调好的单位、阈值、小数位
 * 一次冲掉，且画面上看着像「加成功了」。
 *
 * ⚠ 加数组项要按 `itemSchema` 填**默认值**再覆盖。只写用户提到的那两格的话，
 * 缺的那些在渲染侧落回 `undefined`，表现是新指标那一格什么都不显示。
 *
 * ⚠ 外观键的真源在前端契约（`CHROME_KEYS`），服务端的模块目录里没有这一段。
 * 所以它只能是个客户端工具——服务端答不出这个问题。
 *
 * ⚠ 套一整套观感也只能在这一侧：一套外壳 40 个键，逐键调 `set_config` 就是 40 次
 * 工具调用，中途被上下文截断的话画面停在半套样式上——而半套样式看着像「配错了」。
 */
import { CHROME_KEYS, isChromeKey, styleKeysOf } from '@dt/contracts'
import type { AssistantToolCall, ConfigField } from '@dt/contracts'
import { configDefaults } from '@dt/modules'

import {
  BARE_HIDDEN_KEYS,
  CARD_COMMON_FIELDS,
  CARD_FIELD_GROUPS,
  type CardField,
} from '@/features/dashboard/cardStyleFields'
import { readConfigAt } from '@/features/dashboard/configPath'
import type { SurfaceSnapshot } from '@/features/ai/surfaces'
import type { EditorSurfaceDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const CONFIG_TOOLS = [
  'dashboard.read_config',
  'dashboard.add_config_item',
  'dashboard.remove_config_item',
  'dashboard.chrome_keys',
  'dashboard.apply_style',
] as const

/** 模块级卡片外观住在配置袋子的这一段。 */
const CARD_STYLE = '__cardStyle'

/** 跑一个配置工具；认不出名字给 null，由调用方接着往下问。 */
export function runConfig(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (call.name === 'dashboard.read_config') return readConfig(deps, call)
  if (call.name === 'dashboard.add_config_item') return addItem(deps, call)
  if (call.name === 'dashboard.remove_config_item') return dropItem(deps, call)
  if (call.name === 'dashboard.chrome_keys') return chromeKeys()
  if (call.name === 'dashboard.apply_style') return applyStyle(deps, call)
  return null
}

/**
 * 把一整套观感一次写到节点上：外壳**整袋替换**、内芯浅合并，一次调用一步撤销。
 *
 * ⚠ 外壳整袋换而不是逐键合并：逐键合并会留残留——上一套设过
 * `titleRule: 'hatch'`、新样式没提这个键，合并后斜纹带还在，用户看到的是
 * 「换了样式但没换干净」。
 * ⚠ 内芯逐键校验：一个模块的观感键写到另一个模块上，既不报错也不生效。
 * 这里把这类静默失效翻成一句能读的错——模型看不见画布，它只有响应。
 */
function applyStyle(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const chrome = objectArg(call, 'chrome')
  const config = objectArg(call, 'config')
  const strayChrome = Object.keys(chrome).filter((key) => !isChromeKey(key))
  if (strayChrome.length > 0) {
    throw new Error(
      `外观键不在词汇表里：${strayChrome.join('、')}；` +
        '用 dashboard.chrome_keys 看有哪些',
    )
  }
  const manifest = deps.getManifest(node.moduleType)
  const allowed = new Set(manifest === undefined ? [] : styleKeysOf(manifest))
  const stray = Object.keys(config).filter((key) => !allowed.has(key))
  if (stray.length > 0) {
    throw new Error(
      `${node.moduleType} 没有这些观感键：${stray.join('、')}；` +
        '这套样式多半绑的是别的模块类型，换一条或只套它的外壳',
    )
  }
  const next: Record<string, unknown> = { ...node.configJson, ...config }
  // 空袋子按「删键」处理：外壳的语义是「键不存在 = 没设置」，留一只空对象
  // 与删掉它同义，但会让下次读配置时多出一段说不清的噪声
  if (Object.keys(chrome).length === 0) delete next[CARD_STYLE]
  else next[CARD_STYLE] = chrome
  deps.editor.select(node.id)
  deps.editor.flush()
  deps.actions.changeConfig([], next, false)
  return {
    ok: true,
    node_id: node.id,
    module_type: node.moduleType,
    chrome_keys: Object.keys(chrome).length,
    config_keys: Object.keys(config).length,
    note: '外壳整袋换掉了，内芯按键覆盖；用户按一次 Ctrl+Z 整套退回',
  }
}

/** 一个画布节点此刻配成什么样，外加它吃不吃统一外观。 */
function readConfig(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const manifest = deps.getManifest(node.moduleType)
  const config = { ...node.configJson }
  const chrome = config[CARD_STYLE]
  delete config[CARD_STYLE]
  return {
    node_id: node.id,
    module_type: node.moduleType,
    config,
    card_style: chrome ?? {},
    chrome_configurable: manifest?.chromeConfigurable !== false,
    unsupported_chrome_keys: manifest?.unsupportedChromeKeys ?? [],
    note:
      '`config` 里没有的键 = 没配过，渲染时用模块清单里的 default。' +
      '外观在 card_style，改它用 set_config 的 __cardStyle 路径。',
  }
}

/**
 * 往一个数组配置字段末尾加一项。
 * ⚠ 一次 apply 一笔：用户按一次 Ctrl+Z 应当把这一整项退回去，
 * 而不是退回半项。
 */
function addItem(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const field = arrayFieldOf(deps, call, node.moduleType)
  const rows = rowsOf(node.configJson, field.key)
  const seeded = {
    ...configDefaults(field.itemSchema ?? []),
    ...objectArg(call, 'values'),
  }
  const max = field.maxItems ?? Number.MAX_SAFE_INTEGER
  if (rows.length >= max) {
    throw new Error(`${field.label} 最多 ${max} 项，加不上了`)
  }
  write(deps, node.id, field.key, [...rows, seeded])
  return {
    ok: true,
    node_id: node.id,
    field: field.key,
    index: rows.length,
    item: seeded,
    note: `数据槽的行号与它一致，绑这一行用 …[${rows.length}].value`,
  }
}

/** 删掉数组配置字段里的一项。 */
function dropItem(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const field = arrayFieldOf(deps, call, node.moduleType)
  const rows = rowsOf(node.configJson, field.key)
  const index = intArg(call, 'index')
  if (index < 0 || index >= rows.length) {
    throw new Error(`${field.key} 只有 ${rows.length} 项，没有第 ${index} 项`)
  }
  const min = field.minItems ?? 0
  if (rows.length <= min) {
    throw new Error(`${field.label} 至少要 ${min} 项，删不得`)
  }
  write(
    deps,
    node.id,
    field.key,
    rows.filter((_row, at) => at !== index),
  )
  return {
    ok: true,
    node_id: node.id,
    field: field.key,
    removed_index: index,
    // ⚠ 必须说出来：行与项一一对应，删中间一项之后每一行都改喂前一项
    note: '它之后每一行的数据绑定都改喂前一项了，请重读绑定并跟用户说清',
  }
}

/**
 * 面板上那一行的说明：中文名、所属分组、留空时的平台现值。
 * ⚠ 真源是右栏那份字段表，不另抄一份中文名：抄一份就一定漂成
 * 「面板叫这个名、助手叫那个名」，而用户说的是面板上的那个。
 * @param field 一条外观字段声明
 * @param group 它在面板上归哪一组
 */
function docOf(field: CardField, group: string): [string, SurfaceSnapshot] {
  return [
    field.key,
    {
      label: field.label,
      group,
      // 留空时渲染成什么样；开关类的平台现值是「开」，其余写在占位符里
      platform_default:
        field.placeholder ?? (field.defaultOn === true ? '开' : undefined),
      hint: field.hint,
      help: field.help,
      range: field.range,
    },
  ]
}

/** 键 → 面板上那一行。 */
const CHROME_DOCS = new Map<string, SurfaceSnapshot>([
  ...CARD_COMMON_FIELDS.map((field) => docOf(field, '常用')),
  ...CARD_FIELD_GROUPS.flatMap((group) =>
    group.fields.map((field) => docOf(field, group.label)),
  ),
])

/**
 * 卡片外观的全部可用键，带上面板里的中文名与分组。
 * ⚠ 真源在前端契约，服务端答不出这个问题。
 * ⚠ 中文名必须给：用户说的是「毛玻璃」「呼吸描边」「竖条」，而键名是
 * `backdropBlur` / `borderPulse` / `titleBarWidth`，光看键名对不上。
 */
function chromeKeys(): SurfaceSnapshot {
  return {
    keys: CHROME_KEYS.map((spec) => ({
      key: spec.key,
      type: spec.type,
      values: 'values' in spec ? spec.values : undefined,
      ...(CHROME_DOCS.get(spec.key) ?? {}),
    })),
    // 裸渲染壳（清单里 chrome: 'bare'）压根没有卡片框，这几个键落不到任何地方
    bare_ignores: [...BARE_HIDDEN_KEYS],
    note:
      '单个节点写在 set_config 的 `["__cardStyle","<键>"]` 路径上，' +
      '整套用 apply_style，整屏缺省用 set_page_style。' +
      '⚠ 「键不存在 = 未设置」——要恢复缺省就把值设成 null 删掉这个键，' +
      '不要写一个你以为的默认值进去。' +
      '⚠ 个别模块还会自己拒收其中几个键，那一份在 read_config 的 ' +
      '`unsupported_chrome_keys` 里。',
  }
}

function write(
  deps: EditorSurfaceDeps,
  nodeId: string,
  key: string,
  rows: readonly unknown[],
): void {
  // 先选中：动作层按选中项写，而用户也要看见助手在动哪一个
  deps.editor.select(nodeId)
  deps.editor.flush()
  // 不连续：这一步就是完整的一笔，用户一次 Ctrl+Z 应当整个退回
  deps.actions.changeConfig([key], rows, false)
}

/** 认领那个数组字段；不是数组就直说，不要硬写。 */
function arrayFieldOf(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
  moduleType: string,
): ConfigField {
  const key = textArg(call, 'field')
  const manifest = deps.getManifest(moduleType)
  const field = manifest?.configSchema.find((one) => one.key === key)
  if (field === undefined) {
    throw new Error(`${moduleType} 没有 ${key} 这个配置字段`)
  }
  if (field.type !== 'array') {
    throw new Error(`${key} 不是数组字段，改它用 dashboard.set_config`)
  }
  return field
}

function rowsOf(config: Record<string, unknown>, key: string): unknown[] {
  const given = readConfigAt(config, [key])
  if (!Array.isArray(given)) return []
  const rows: unknown[] = given
  return [...rows]
}

function nodeOf(deps: EditorSurfaceDeps, call: AssistantToolCall) {
  const nodeId = textArg(call, 'node_id')
  const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
  if (node === undefined) throw new Error(`画布上没有 ${nodeId} 这个节点`)
  return node
}

function objectArg(
  call: AssistantToolCall,
  name: string,
): Record<string, unknown> {
  const given = call.arguments[name]
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return {}
  }
  return { ...given }
}

function intArg(call: AssistantToolCall, name: string): number {
  const given = call.arguments[name]
  if (typeof given !== 'number' || !Number.isInteger(given)) {
    throw new Error(`${call.name} 的 ${name} 必须是整数`)
  }
  return given
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
