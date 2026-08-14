/**
 * @fileoverview 模块上抛联动事件的公共接线。「点一行 → 上抛这一行的值」在列表与表格族
 * 里是同一件事，收在这里免得每个模块各写一份、各自决定空值上不上抛。
 */
import type { InteractionEvent } from '@dt/contracts'

/** 模块 `defineEmits<{ interaction: [InteractionEvent] }>()` 拿到的 emit 的类型。 */
export type InteractionEmit = (
  name: 'interaction',
  payload: InteractionEvent,
) => void

/**
 * 造一个行点击上抛器，模板里写成 `@click.stop="onRowClick(row.key)"`。
 * ⚠ `.stop` 必须由调用方在模板上写：外层开着「整块可点」时，不吞冒泡的话同一次点击
 * 会再上抛一个**没有 value** 的 click，toggle 类动作当场自我抵消。
 * ⚠ 空值不上抛：没有 value 的联动事件没有任何规则用得上它，上抛只会误触无值那条路径。
 * @param emit 模块自己的 emit
 */
export function rowClickEmitter(
  emit: InteractionEmit,
): (value: string) => void {
  return (value: string) => {
    if (value !== '') emit('interaction', { event: 'click', value })
  }
}
