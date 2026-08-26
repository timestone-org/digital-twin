/**
 * @fileoverview 助手输入区与面板的按键判定，纯函数、无 Vue、无 DOM 监听。
 * 装载在 AiComposer / AiDock；判定单独成层是为了让「IME 期间的 Enter 不发送」
 * 这类规矩可被单测钉住（编辑器的 shortcutKeys.ts 是同一个做法）。
 */

/** 输入框里一次按键要做的事；null = 交回给 textarea 默认行为。 */
export type ComposeKeyAction = 'send' | 'recall'

/** 判定用得到的那几格，收窄成结构而不是收 KeyboardEvent，好造好测。 */
export interface ComposeKeyStroke {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  /** IME 组合中。⚠ Safari 在收字那一下已经是 false 而 keyCode 还是 229。 */
  isComposing: boolean
  keyCode: number
}

/**
 * 输入框里的一次按键判定成哪个动作。
 *
 * Enter 发送、Shift/Alt+Enter 换行、⌘/Ctrl+Enter 也发送（顺许多工具的手）；
 * 草稿为空时 ↑ 召回上一句自己说的话。
 * ⚠ IME 组合期间的 Enter 是在选字不是要发送，两个口径都要认（见上）。
 *
 * @param stroke 这次按键
 * @param hasDraft 草稿里已经有字
 */
export function composeKeyOf(
  stroke: ComposeKeyStroke,
  hasDraft: boolean,
): ComposeKeyAction | null {
  if (stroke.key === 'Enter') return enterOf(stroke)
  if (stroke.key === 'ArrowUp') return recallOf(stroke, hasDraft)
  return null
}

function enterOf(stroke: ComposeKeyStroke): ComposeKeyAction | null {
  if (stroke.isComposing || stroke.keyCode === 229) return null
  return stroke.shiftKey || stroke.altKey ? null : 'send'
}

function recallOf(
  stroke: ComposeKeyStroke,
  hasDraft: boolean,
): ComposeKeyAction | null {
  const modified =
    stroke.shiftKey || stroke.altKey || stroke.metaKey || stroke.ctrlKey
  return modified || hasDraft ? null : 'recall'
}

/**
 * 是不是「开合助手」的全局手势：⌘I（Mac）/ Ctrl+I（其余平台）。
 * 编辑器的 ⌘S/Z/C/V/A/[/] 与缩放键都让开了，I 两边都没占。
 * @param stroke 这次按键
 */
export function isAssistantToggle(stroke: ComposeKeyStroke): boolean {
  return (
    stroke.key.toLowerCase() === 'i' &&
    (stroke.metaKey || stroke.ctrlKey) &&
    !stroke.shiftKey &&
    !stroke.altKey
  )
}

/** 修饰键显示名：Mac 系用 ⌘，其余平台用 Ctrl。按 platform 串判定，不碰 DOM。 */
export function modLabelOf(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl'
}
