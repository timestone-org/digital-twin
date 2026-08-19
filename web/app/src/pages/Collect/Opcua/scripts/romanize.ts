/**
 * @fileoverview 中文转写成拼音，用来给中文命名的现场标记推一个能看懂的编码。
 *
 * ⚠ 按需动态加载：字典有一百多 KB，而它只在「导入的节点里有中文名」时才用得
 * 上。静态 import 会让它跟着采集页一起下发给每一个只是来看看点位的人。
 *
 * ⚠ 加载不动就退回「不转写」而不是报错：转写只是给编码一个建议，用户在弹窗里
 * 本来就能自己填。
 */
import type { Romanize } from './browseTree'

/** 不转写：调用方据此把编码留空，交给人填。 */
const NONE: Romanize = () => ''

/**
 * 取一个转写函数。加载失败时给「不转写」。
 *
 * ⚠ `v: true` 不能省：`功率` 的韵母是 ü，不转成 v 就会被后面的归一化当成分隔
 * 符扔掉，`gong_lü` 于是变成 `gong_l`。
 */
export async function loadRomanize(): Promise<Romanize> {
  try {
    const { pinyin } = await import('pinyin-pro')
    return (text) =>
      pinyin(text, { toneType: 'none', type: 'array', v: true }).join('_')
  } catch {
    return NONE
  }
}
