/**
 * @fileoverview 配置对象上的按路径读写，供属性面板的对象 / 数组字段递归下去。
 * ⚠ 写是**不可变**的：沿路径逐层复制，其余引用原样保留。就地改的话，撤销栈里
 * 那些快照与当前值是同一个对象，撤销会「回到自己」而不报错。
 */

/** 一条配置路径，字符串是对象键、数字是数组下标。 */
export type ConfigPath = readonly (string | number)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ⚠ 要的是 `unknown[]` 而不是 `Array.isArray` 收窄出来的 `any[]`：
 *  后者一展开，数组里装的是什么就再也没人检查了。 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/**
 * 读一条路径上的值；路上任何一层缺席都给 undefined。
 * @param root 配置对象
 * @param path 路径
 */
export function readConfigAt(root: unknown, path: ConfigPath): unknown {
  let cursor: unknown = root
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!isUnknownArray(cursor)) return undefined
      cursor = cursor[segment]
      continue
    }
    if (!isRecord(cursor)) return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/**
 * 沿路径写一个值，返回新的配置对象。
 * ⚠ 路上遇到类型对不上的中间层（该是对象却是字符串）一律**换成新容器**，
 * 不是静默放弃：放弃的话用户改了一个字段却什么都没发生。
 * @param root 配置对象
 * @param path 路径，空路径即整体替换
 * @param value 新值
 */
export function writeConfigAt(
  root: Record<string, unknown>,
  path: ConfigPath,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) {
    return isRecord(value) ? value : root
  }
  const next = writeInto(root, head, rest, value)
  return isRecord(next) ? next : root
}

/** 往一个容器的某一段里写；容器不对就新建一个。 */
function writeInto(
  container: unknown,
  segment: string | number,
  rest: ConfigPath,
  value: unknown,
): unknown {
  if (typeof segment === 'number') {
    const rows: unknown[] = isUnknownArray(container) ? [...container] : []
    rows[segment] = descend(rows[segment], rest, value)
    return rows
  }
  const record = isRecord(container) ? { ...container } : {}
  record[segment] = descend(record[segment], rest, value)
  return record
}

function descend(current: unknown, rest: ConfigPath, value: unknown): unknown {
  const [head, ...tail] = rest
  if (head === undefined) return value
  return writeInto(current, head, tail, value)
}

/**
 * 删掉数组里的一行，返回新的配置对象。
 * @param root 配置对象
 * @param path 指向数组的路径
 * @param index 行号
 */
export function removeConfigRow(
  root: Record<string, unknown>,
  path: ConfigPath,
  index: number,
): Record<string, unknown> {
  const rows = readConfigAt(root, path)
  if (!isUnknownArray(rows)) return root
  return writeConfigAt(
    root,
    path,
    rows.filter((_row, at) => at !== index),
  )
}

/**
 * 往数组末尾追加一行，返回新的配置对象。
 * @param root 配置对象
 * @param path 指向数组的路径
 * @param row 新行
 */
export function appendConfigRow(
  root: Record<string, unknown>,
  path: ConfigPath,
  row: unknown,
): Record<string, unknown> {
  const rows = readConfigAt(root, path)
  const current: readonly unknown[] = isUnknownArray(rows) ? rows : []
  return writeConfigAt(root, path, [...current, row])
}
