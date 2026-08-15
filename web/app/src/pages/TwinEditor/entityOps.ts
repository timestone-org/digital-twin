/**
 * @fileoverview 六类实体的增删改与重排。全是纯函数：收一份配置，回一份新配置。
 *
 * ⚠ 一律返回新对象、绝不就地改：文档态靠「换引用」触发重渲染与压撤销栈，
 * 就地改的那一次界面照常刷新，但撤销栈里前后两帧会指向同一个对象，
 * 撤销回去等于什么都没变。
 */
import {
  type TwinConfig,
  type TwinPanelField,
  normalizeTwinConfig,
} from '@dt/twin-config'

import { TWIN_ENTITY_LABELS } from './types'
import type { TwinEntityKind, TwinEntityLists } from './types'

/** 生成实体 id。可注入，测试里换成可预期的序列。 */
export type TwinIdFactory = (prefix: string) => string

const ID_PREFIX: Readonly<Record<TwinEntityKind, string>> = {
  parts: 'part',
  anchors: 'anchor',
  cameras: 'camera',
  panels: 'panel',
  arrows: 'arrow',
  flows: 'flow',
}

/**
 * 默认 id：前缀加一段随机十六进制。
 * ⚠ 不用「现有条数 + 1」：删掉中间一条之后它会与尚存的某一条重名，
 * 而重名在渲染层表现为两个实体抢同一份实时值，界面上看不出是重名造成的。
 * ⚠ 取值来自 `Math.random`，只用于本地标识，不做任何安全用途。
 */
export function newEntityId(prefix: string): string {
  const random = Math.random().toString(16).slice(2, 8).padEnd(6, '0')
  return `${prefix}-${random}`
}

/** 造一个在 `taken` 里不重名的 id。 */
function freshId(
  kind: TwinEntityKind,
  taken: ReadonlySet<string>,
  makeId: TwinIdFactory,
): string {
  const prefix = ID_PREFIX[kind]
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = makeId(prefix)
    if (!taken.has(candidate)) return candidate
  }
  // 注入的 id 工厂只会给固定值时才会走到这里；改用序号，且序号本身也要避开已用的
  let index = taken.size
  while (taken.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function idsOf(config: TwinConfig, kind: TwinEntityKind): Set<string> {
  return new Set(config[kind].map((item) => item.id))
}

/**
 * 空白实体的模板：只给 id 与名字，其余交给归一化补缺省。
 * ⚠ 这里不要抄一份缺省值：抄的那份一旦与归一化不一致，新建的东西会在
 * 「存一次再读回来」之后悄悄变样。
 */
function blank(
  kind: TwinEntityKind,
  id: string,
  index: number,
): Record<string, unknown> {
  const base = { id, name: `${TWIN_ENTITY_LABELS[kind]} ${index + 1}` }
  // 牌至少带一个字段，否则它在画布上是一张空卡片
  return kind === 'panels' ? { ...base, fields: [blankPanelField(0)] } : base
}

/** 信息牌上一个空字段。 */
export function blankPanelField(index: number): Partial<TwinPanelField> {
  return { key: `f${index + 1}`, label: `字段 ${index + 1}` }
}

/** 归一化收口：所有写操作都从这里出去，缺省值只有一处定义。 */
function renormalize(config: unknown): TwinConfig {
  return normalizeTwinConfig(config)
}

/**
 * 新增一个实体，追加在末尾。
 * @param config 当前配置
 * @param kind 实体集合
 * @param makeId id 工厂，缺省随机
 */
export function addEntity(
  config: TwinConfig,
  kind: TwinEntityKind,
  makeId: TwinIdFactory = newEntityId,
): { config: TwinConfig; id: string } {
  const id = freshId(kind, idsOf(config, kind), makeId)
  const next = renormalize({
    ...config,
    [kind]: [...config[kind], blank(kind, id, config[kind].length)],
  })
  return { config: next, id }
}

/**
 * 删掉一个实体。
 * ⚠ 只删它自己，不清理指向它的引用：悬空引用由 `collectTwinConfigIssues`
 * 报给用户看，这里静默清掉的话，用户会以为自己配的东西凭空消失了。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 要删的实体 id
 */
export function removeEntity(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
): TwinConfig {
  return renormalize({
    ...config,
    [kind]: config[kind].filter((item) => item.id !== id),
  })
}

/**
 * 复制一个实体，插在它自己后面。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 被复制的实体 id
 * @param makeId id 工厂，缺省随机
 */
export function duplicateEntity(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
  makeId: TwinIdFactory = newEntityId,
): { config: TwinConfig; id: string | null } {
  const list = config[kind]
  const index = list.findIndex((item) => item.id === id)
  const source = list[index]
  if (source === undefined) return { config, id: null }

  const nextId = freshId(kind, idsOf(config, kind), makeId)
  const copy = { ...source, id: nextId, name: `${source.name} 副本` }
  const nextList = [...list.slice(0, index + 1), copy, ...list.slice(index + 1)]
  return { config: renormalize({ ...config, [kind]: nextList }), id: nextId }
}

/**
 * 上移或下移一个实体。
 * ⚠ 文档序不只是显示顺序：数组绑定按它对齐，所以移动一条会连带改变
 * 它与相邻那条的取值来源——调用方必须跟着重派绑定。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 要移动的实体 id
 * @param delta -1 上移，1 下移
 */
export function moveEntity(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
  delta: number,
): TwinConfig {
  const list = config[kind]
  const from = list.findIndex((item) => item.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return config

  const nextList = [...list]
  const [moved] = nextList.splice(from, 1)
  if (moved === undefined) return config
  nextList.splice(to, 0, moved)
  return renormalize({ ...config, [kind]: nextList })
}

/**
 * 改一个实体的若干字段。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 要改的实体 id
 * @param patch 要覆盖的字段
 */
export function updateEntity<K extends TwinEntityKind>(
  config: TwinConfig,
  kind: K,
  id: string,
  patch: Partial<TwinEntityLists[K]>,
): TwinConfig {
  const list: readonly { id: string }[] = config[kind]
  if (!list.some((item) => item.id === id)) return config
  return renormalize({
    ...config,
    [kind]: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  })
}
