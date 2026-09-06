/**
 * @fileoverview 挂在一块上的那几句话：读出来并分成两档。
 *
 * ⚠ 两档不能合并（规格 §11 的 R-24）：`alert` 是会让人读出错误结论的那一句，
 * 必须整条摆在版面上；`hint` 是口径说明，摆成一行灰字就够。合成一档之后，要么
 * 告警被淹在一堆口径里，要么口径把版面撑满。
 * ⚠ 一句读成纯字符串时按 `hint` 收：后端两种写法都出现过，读不出档次不等于
 * 这句话可以丢。
 */
import { recordOf } from './reportBlocks'

/** 两档：整条摆出来的告警 / 一行灰字的口径说明。 */
export const NOTE_LEVELS = ['alert', 'hint'] as const

export type NoteLevel = (typeof NOTE_LEVELS)[number]

export interface BlockNote {
  readonly level: NoteLevel
  readonly text: string
}

function levelOf(value: unknown): NoteLevel {
  return value === 'alert' ? 'alert' : 'hint'
}

/**
 * 一块上挂着的话。读不出正文的那一条丢掉——空气泡比没有气泡更让人疑惑。
 *
 * Args: payload 这一块的 payload。
 */
export function notesOf(payload: Record<string, unknown>): BlockNote[] {
  const raw = payload['notes']
  const list = Array.isArray(raw) ? raw : []
  const made: BlockNote[] = []
  for (const one of list) {
    if (typeof one === 'string') {
      if (one !== '') made.push({ level: 'hint', text: one })
      continue
    }
    const item = recordOf(one)
    const text = item['text']
    if (typeof text === 'string' && text !== '') {
      made.push({ level: levelOf(item['level']), text })
    }
  }
  return made
}

/** 告警排在口径说明前面：同一档内保持后端给的先后。 */
export function sortedNotes(notes: readonly BlockNote[]): BlockNote[] {
  return [
    ...notes.filter((one) => one.level === 'alert'),
    ...notes.filter((one) => one.level === 'hint'),
  ]
}
