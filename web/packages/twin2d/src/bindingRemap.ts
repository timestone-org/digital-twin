/**
 * @fileoverview 配置改动前后对比，把三个数组槽的绑定从旧行号搬到新行号。
 *
 * ⚠ 为什么必须**无条件**重派：`commit()` 是配置的唯一写入口（§14.3）。放开让各处
 * 自己写配置，总会有一个动作忘了重派，之后每条绑定都接错对象——而界面上一切正常，
 * 读数照常刷新，只是全喂到了别的节点、别的槽位上。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §14.2 与 §14.3。
 */
import { twin2dBindingRows } from './bindingRows'
import {
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_EDGE_ROW_SLOTS,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_NODE_ROW_SLOTS,
  TWIN_2D_STATUS_BINDING_KEY,
  TWIN_2D_STATUS_ROW_SLOTS,
  arrayRowFieldKey,
} from './constants'
import type { Twin2dBindingRow } from './bindingRows'
import type { Twin2dRowSlot } from './constants'
import type { Twin2dConfig } from './types'

/**
 * 三个数组槽各自的行内子槽。
 * ⚠ 一行的**每个**子槽都要搬：连线一行有三个子槽，只搬 `active` 会让同一条线的
 * 流向与标签读数留在旧行号上，于是那两项从此喂给另一条连线（§14.1）。
 */
const ROW_SUBS: ReadonlyMap<string, readonly Twin2dRowSlot[]> = new Map<
  string,
  readonly Twin2dRowSlot[]
>([
  [TWIN_2D_NODE_BINDING_KEY, TWIN_2D_NODE_ROW_SLOTS],
  [TWIN_2D_STATUS_BINDING_KEY, TWIN_2D_STATUS_ROW_SLOTS],
  [TWIN_2D_EDGE_BINDING_KEY, TWIN_2D_EDGE_ROW_SLOTS],
])

/**
 * 一行的稳定键：槽 + 实体 +（只有 `nodeValues` 才有的）槽位键。
 *
 * ⚠ 子槽名不进键，它在重派里原样带走：拿它找人的话，清单里新增一个子槽就会让
 * 那一档的存量绑定全都找不到对应而被整条丢掉。
 * ⚠ 用 JSON 拼而不是拿分隔符连：实体 id 与槽位键都是用户可写的自由文本，两个
 * 实体撞出同一个串就会共用一行——那正是这份文件要防的事。
 * @param row 一条绑定行
 */
function stableKey(row: Twin2dBindingRow): string {
  return JSON.stringify([row.slotKey, row.entityId, row.entitySlot])
}

/**
 * 新配置里每个稳定键落在第几行。
 * @param rows 新配置的全部绑定行
 */
function indexByKey(rows: readonly Twin2dBindingRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) out.set(stableKey(row), row.index)
  return out
}

/**
 * 旧 fieldKey → 新 fieldKey 的对照表。
 * ⚠ 实体在新配置里没了的那些行**不进表**，调用方按「查不到」把绑定整条丢弃：
 * 留着它会占住一个行号，把它后面的每一条又推错一格。
 * @param before 改动前的全部绑定行
 * @param after 改动后的全部绑定行
 */
function movedKeys(
  before: readonly Twin2dBindingRow[],
  after: readonly Twin2dBindingRow[],
): Map<string, string> {
  const indexOf = indexByKey(after)
  const moved = new Map<string, string>()
  for (const [slotKey, subs] of ROW_SUBS) {
    for (const row of before) {
      if (row.slotKey !== slotKey) continue
      const to = indexOf.get(stableKey(row))
      if (to === undefined) continue
      for (const sub of subs) {
        const from = arrayRowFieldKey(slotKey, row.index, sub)
        moved.set(from, arrayRowFieldKey(slotKey, to, sub))
      }
    }
  }
  return moved
}

/**
 * 这条 fieldKey 是不是三个数组槽里的某一行。
 * ⚠ 认的是 `槽键[`，不是前缀相等：别的模块槽叫 `nodeValues2` 时，前缀相等会把它的
 * 绑定当成孪生自己的行一起搬走。
 * @param fieldKey 落库的 fieldKey
 */
function isArrayRow(fieldKey: string): boolean {
  for (const slotKey of ROW_SUBS.keys()) {
    if (fieldKey.startsWith(`${slotKey}[`)) return true
  }
  return false
}

/**
 * 配置改动前后对比，把三个数组槽的绑定一次全搬到位。
 *
 * ⚠ 别挑「看起来会影响绑定」的那几个动作调用——会影响的动作比直觉多：给某个节点
 * 添一个引用了新槽位的 `txt` 图元，会让**它之后的每一行**整体后移一格，因为
 * `nodeValues` 的行是「节点 × 有效槽位」扁平后的序（§14.2）。
 * ⚠ 只按 `fieldKey` 认人、其余字段整份带走：这里既要能搬已落库的绑定，也要能搬
 * 编辑器里还没落库的草稿，两者字段集不同。
 * ⚠ 认不出的 fieldKey 与别的槽原样留着：同一个节点上还有别的模块槽，把它们当成
 * 「找不到实体」删掉就是静默吃掉用户配好的数据。
 *
 * @param prev 改动前的**归一化**配置
 * @param next 改动后的**归一化**配置
 * @param bindings 该节点当前的全部绑定
 */
export function remapTwin2dBindings<T extends { fieldKey: string }>(
  prev: Twin2dConfig,
  next: Twin2dConfig,
  bindings: readonly T[],
): T[] {
  const moved = movedKeys(twin2dBindingRows(prev), twin2dBindingRows(next))
  const kept: T[] = []
  for (const binding of bindings) {
    const fieldKey = moved.get(binding.fieldKey)
    if (fieldKey === undefined) {
      if (isArrayRow(binding.fieldKey)) continue
      kept.push(binding)
      continue
    }
    kept.push(
      fieldKey === binding.fieldKey ? binding : { ...binding, fieldKey },
    )
  }
  return kept
}
