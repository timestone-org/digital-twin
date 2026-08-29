/**
 * @fileoverview 自定义卡片页对配置做的那几笔改动，全是**纯函数**：进去一份 config，
 * 出来一份新的。判定收在这里而不是组件里，是为了让「删到只剩一件时该拦住」这类
 * 边界能被单测钉住。
 *
 * ⚠ 一律返回新对象，不就地改：页面把整份 config 交给 `shallowRef` 持有，
 * 就地改的话预览与表单都不会重算，用户看到的是「拖了没反应」。
 */
import { readArray, readRecord, readText } from '@dt/modules'

/** 部件表与格表落在配置的这两个键上。⚠ 与可组合卡片那个模块清单里的键逐字相同。 */
export const PARTS_KEY = 'parts'
export const CELLS_KEY = 'cells'

/** 至少留一件 / 一格：空表时卡片是一块什么都没有的白板，看着像坏了。 */
const MIN_ROWS = 1

function rowsOf(config: Record<string, unknown>, key: string): unknown[] {
  return [...readArray(config[key])]
}

function withRows(
  config: Record<string, unknown>,
  key: string,
  rows: readonly unknown[],
): Record<string, unknown> {
  return { ...config, [key]: [...rows] }
}

/** 部件表；每一项至少带得出一个 `kind`。 */
export function partsOf(
  config: Record<string, unknown>,
): Record<string, unknown>[] {
  return rowsOf(config, PARTS_KEY).map((one) => readRecord(one))
}

/** 格表。 */
export function cellsOf(
  config: Record<string, unknown>,
): Record<string, unknown>[] {
  return rowsOf(config, CELLS_KEY).map((one) => readRecord(one))
}

/**
 * 加一件部件，落在末尾。
 * @param config 当前配置
 * @param kind 部件档名
 */
export function addPart(
  config: Record<string, unknown>,
  kind: string,
): Record<string, unknown> {
  return withRows(config, PARTS_KEY, [...partsOf(config), { kind }])
}

/**
 * 删一件部件。
 * ⚠ 删到最后一件时拒绝：一件都不剩的卡片是空白板，而用户多半只是想换一件。
 * @param config 当前配置
 * @param index 第几件
 */
export function removePart(
  config: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const rows = partsOf(config)
  if (rows.length <= MIN_ROWS || index < 0 || index >= rows.length)
    return config
  return withRows(
    config,
    PARTS_KEY,
    rows.filter((_row, at) => at !== index),
  )
}

/**
 * 把一件部件上移或下移一位。
 * ⚠ 到头了就原样返回，不绕回另一端：绕回去在一列表里看着像「跳走了」。
 * @param config 当前配置
 * @param index 第几件
 * @param delta -1 上移 / 1 下移
 */
export function movePart(
  config: Record<string, unknown>,
  index: number,
  delta: number,
): Record<string, unknown> {
  const rows = partsOf(config)
  const to = index + delta
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) {
    return config
  }
  const next = [...rows]
  const moved = next[index]
  const target = next[to]
  if (moved === undefined || target === undefined) return config
  next[index] = target
  next[to] = moved
  return withRows(config, PARTS_KEY, next)
}

/**
 * 加一个格。名字按序号起，免得一排「未命名」分不清。
 * @param config 当前配置
 */
export function addCell(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const rows = cellsOf(config)
  return withRows(config, CELLS_KEY, [
    ...rows,
    { label: `点位 ${String(rows.length + 1)}`, unit: '', precision: 1 },
  ])
}

/**
 * 删一个格。
 * ⚠ 删中间一格之后，它之后每一格的**绑定都会改喂前一格**——调用方必须把这句话
 * 告诉用户（DASHBOARD_DESIGN §4.2）。这里只管数据。
 * @param config 当前配置
 * @param index 第几格
 */
export function removeCell(
  config: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const rows = cellsOf(config)
  if (rows.length <= MIN_ROWS || index < 0 || index >= rows.length)
    return config
  return withRows(
    config,
    CELLS_KEY,
    rows.filter((_row, at) => at !== index),
  )
}

/**
 * 改一件部件或一个格上的某个键。
 * @param config 当前配置
 * @param key 表键（部件表或格表）
 * @param index 第几行
 * @param field 字段键
 * @param value 新值
 */
export function setRowField(
  config: Record<string, unknown>,
  key: string,
  index: number,
  field: string,
  value: unknown,
): Record<string, unknown> {
  const rows = rowsOf(config, key).map((one) => readRecord(one))
  const row = rows[index]
  if (row === undefined) return config
  rows[index] = { ...row, [field]: value }
  return withRows(config, key, rows)
}

/**
 * 某一件部件是哪一档。
 * @param config 当前配置
 * @param index 第几件
 */
export function partKindAt(
  config: Record<string, unknown>,
  index: number,
): string {
  return readText(partsOf(config)[index]?.kind)
}
