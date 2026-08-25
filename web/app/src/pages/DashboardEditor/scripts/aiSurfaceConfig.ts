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
 */
import { CHROME_KEYS, type ConfigField } from '@dt/contracts'
import type { AssistantToolCall } from '@dt/contracts'
import { configDefaults } from '@dt/modules'

import { readConfigAt } from '@/features/dashboard/configPath'
import type { SurfaceSnapshot } from '@/features/ai/surfaces'
import type { EditorSurfaceDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const CONFIG_TOOLS = [
  'dashboard.read_config',
  'dashboard.add_config_item',
  'dashboard.remove_config_item',
  'dashboard.chrome_keys',
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
  return null
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

/** 卡片外观的全部可用键。⚠ 真源在前端契约，服务端答不出这个问题。 */
function chromeKeys(): SurfaceSnapshot {
  return {
    keys: CHROME_KEYS.map((spec) => ({
      key: spec.key,
      type: spec.type,
      values: 'values' in spec ? spec.values : undefined,
    })),
    note:
      '写在 set_config 的 `["__cardStyle","<键>"]` 路径上。' +
      '⚠ 「键不存在 = 未设置」——要恢复缺省就把值设成 null 删掉这个键，' +
      '不要写一个你以为的默认值进去。',
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
