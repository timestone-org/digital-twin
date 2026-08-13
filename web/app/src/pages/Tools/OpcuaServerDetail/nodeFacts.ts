/**
 * @fileoverview 把 OPC UA 的裸数字翻译成人话。纯函数，可整体单测。
 *
 * ⚠ `value_rank: -1`、`access_level: 3` 这类取值直接摆在界面上等于没说：
 * 它们是 OPC UA 规范里的编码，不是常识。页面要么翻译，要么别显示——
 * 显示一个没人看得懂的数字只会让人以为自己漏了什么。
 */

/**
 * 节点类别对应的图标：容器与叶子一眼能分开。
 *
 * ⚠ 树里是**动态绑定** `:name`，而 `DtIcon.contract.spec.ts` 只扫模板里的
 * 字面量 `name="..."`——写错一个名字它抓不到，界面上只是图标位置空着。
 * `nodeFacts.test.ts` 有一条用例把这张表的取值与图标注册表对一遍。
 *
 * ⚠ `method` 也给一个图标，尽管后端拒绝创建方法节点：地址空间的数据未必
 * 都经过本服务的 API（外部工具直接改库、将来支持方法节点），落到兜底就与
 * 变量长得一模一样，人分不出这一行是个能被调用的东西。`arrow-right` 取的
 * 是「调用」的语义，图标库里没有更贴的，不为此单画一个。
 */
const CLASS_ICONS: Record<string, string> = {
  object: 'layout-grid',
  variable: 'activity',
  property: 'table',
  method: 'arrow-right',
}

/** 兜底图标。导出是为了让契约测试连它一起检。 */
export const FALLBACK_NODE_ICON = 'activity'

/** 这张表里全部会用到的图标名，契约测试拿它去比对注册表。 */
export const NODE_ICON_NAMES: readonly string[] = [
  ...new Set([...Object.values(CLASS_ICONS), FALLBACK_NODE_ICON]),
]

/**
 * @param nodeClass 节点类别
 */
export function iconOfClass(nodeClass: string): string {
  return CLASS_ICONS[nodeClass] ?? FALLBACK_NODE_ICON
}

/** AccessLevel 是位掩码。这里只翻译本服务真正会用到的四位。 */
const ACCESS_BITS: readonly { bit: number; label: string }[] = [
  { bit: 0b0001, label: '可读' },
  { bit: 0b0010, label: '可写' },
  { bit: 0b0100, label: '可读历史' },
  { bit: 0b1000, label: '可写历史' },
]

/**
 * 把 AccessLevel 掩码翻成标签数组。
 * @param level 掩码
 */
export function accessLabels(level: number): string[] {
  const found = ACCESS_BITS.filter((entry) => (level & entry.bit) !== 0).map(
    (entry) => entry.label,
  )
  // 0 是合法取值：既不可读也不可写的节点存在（占位用），别显示成空白
  return found.length > 0 ? found : ['不可读写']
}

/** 该节点是否允许写——写值区要不要出现全看它。 */
export function isWritable(level: number): boolean {
  return (level & 0b0010) !== 0
}

/**
 * ValueRank 的规范取值。负数各有含义，正数就是维数。
 * @param rank 取值
 */
export function valueRankLabel(rank: number): string {
  const named: Record<number, string> = {
    [-3]: '标量或一维数组',
    [-2]: '任意维度',
    [-1]: '标量',
    0: '一维或更高',
    1: '一维数组',
  }
  return named[rank] ?? `${rank} 维数组`
}

/**
 * 值的展示形式。⚠ `undefined`（还没取到）与 `null`（取到了，值就是空）
 * 必须分开——把两者都画成「—」会让人分不清是没读到还是读到了空。
 * @param value 任意取值
 */
export function displayValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  // 数组与结构体：JSON 化，别落到 '[object Object]'
  return JSON.stringify(value) ?? '—'
}
