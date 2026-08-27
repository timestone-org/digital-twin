/**
 * @fileoverview 2D 孪生编辑器的键盘手势：删除、复制剪切粘贴再制、撤销重做、方向键
 * 微调（步长跟着这张图的栅格走）、Esc 收手势、数字键切工具。判定是纯函数，装载那一支
 * 把 window 监听挂上并在卸载时摘干净。
 *
 * ⚠ 表单获焦时编辑类手势全部让位，而 `isTwin2dFormFocused` 按**最近可交互祖先**判，
 *   不是只看 `activeElement.tagName`：设计系统的下拉触发器是 `<button role="combobox">`，
 *   它的方向键只 `preventDefault` 不 `stopPropagation`，只看 tagName 的话用户键盘翻选项
 *   时画布上选中的节点会**同时**被 nudge 一格并压进撤销栈——不报错，图悄悄动了，而用户
 *   以为自己只是在选下拉。弹窗（`role="dialog"`）里的一切输入同理要独占键盘。
 * ⚠ ⌘S 连表单里也接管：保存不该因为焦点在输入框里就变成浏览器的「另存网页」。
 * ⚠ 表单里的 Esc 只退出输入焦点，不清画布选中、不收手势。
 */
import { TWIN_2D_DEFAULT_GRID } from '@dt/twin2d'
import type { Pt } from '@dt/twin2d'
import { onMounted, onUnmounted } from 'vue'

/**
 * 数字键 1..6 对应的工具。
 * ⚠ 次序就是键位，插一档进中间会把用户练熟的键位整体挪一位；新工具往后加。
 */
export const TWIN_2D_TOOLS = [
  'select',
  'pan',
  'link',
  'rect',
  'line',
  'text',
] as const
export type Twin2dTool = (typeof TWIN_2D_TOOLS)[number]

/** 四个方向键各自的单位位移；`y` 向下为正，与设计坐标同向。 */
export const TWIN_2D_ARROWS: Readonly<Record<string, Pt>> = Object.freeze({
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
})

/** 按住 Shift 的粗调是多少格。 */
const COARSE_FACTOR = 10

/**
 * 焦点算不算落在「该独占键盘」的东西里。
 * ⚠ 逐字口径见文件头那条：按最近可交互祖先判，只看 tagName 会静默挪节点。
 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]),' +
  ' [role="combobox"], [role="listbox"], [role="dialog"]'

export function isTwin2dFormFocused(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLElement &&
    active.closest(INTERACTIVE_SELECTOR) !== null
  )
}

/** 一次按键落到哪个动作上。 */
export type Twin2dShortcutAction =
  | 'save'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'remove'
  | 'selectAll'
  | 'escape'
  | 'nudge'
  | 'selectTool'

/** ⌘/Ctrl + 键 的编辑类手势；`z` 另按 Shift 分叉成重做。 */
const EDIT_COMMAND: Readonly<Record<string, Twin2dShortcutAction>> =
  Object.freeze({
    z: 'undo',
    y: 'redo',
    c: 'copy',
    x: 'cut',
    v: 'paste',
    d: 'duplicate',
    a: 'selectAll',
  })

/**
 * 这个键切到哪个工具；不是工具键给 null。
 * @param key 按键名
 */
export function twin2dToolOf(key: string): Twin2dTool | null {
  const index = Number.parseInt(key, 10) - 1
  if (!Number.isInteger(index)) return null
  return TWIN_2D_TOOLS[index] ?? null
}

/**
 * 方向键一步走多远（设计像素）：Alt 精调 1 px、Shift 粗调十格、其余一格。
 * ⚠ 栅格取不到正数时回缺省栅格：0 会让方向键按了没反应，NaN 会把节点坐标整片写成
 * NaN——那之后整块画布空白，而每一处取值看着都「有值」。
 * @param event 键盘事件
 * @param grid 这张图的栅格步长
 */
export function twin2dNudgeStep(event: KeyboardEvent, grid: number): number {
  if (event.altKey) return 1
  const step =
    Number.isFinite(grid) && grid >= 1 ? Math.round(grid) : TWIN_2D_DEFAULT_GRID
  return event.shiftKey ? step * COARSE_FACTOR : step
}

/**
 * 这一下方向键要挪多少；不是方向键给 null。
 * @param event 键盘事件
 * @param grid 这张图的栅格步长
 */
export function twin2dNudgeOf(event: KeyboardEvent, grid: number): Pt | null {
  const at = TWIN_2D_ARROWS[event.key]
  if (at === undefined) return null
  const step = twin2dNudgeStep(event, grid)
  return { x: at.x * step, y: at.y * step }
}

/** 按住修饰键的那几个；⌘⇧Z 与 ⌘Y 同为重做。 */
function commandActionOf(event: KeyboardEvent): Twin2dShortcutAction | null {
  const action = EDIT_COMMAND[event.key.toLowerCase()] ?? null
  return action === 'undo' && event.shiftKey ? 'redo' : action
}

/** 不带修饰键的那几个。 */
function plainActionOf(event: KeyboardEvent): Twin2dShortcutAction | null {
  const key = event.key
  if (key === 'Delete' || key === 'Backspace') return 'remove'
  if (key in TWIN_2D_ARROWS) return 'nudge'
  return twin2dToolOf(key) === null ? null : 'selectTool'
}

/**
 * 判定一次按键触发哪个动作；不触发给 null。
 * @param event 键盘事件
 * @param formFocused 焦点是否落在该独占键盘的东西里
 */
export function twin2dShortcutOf(
  event: KeyboardEvent,
  formFocused: boolean,
): Twin2dShortcutAction | null {
  const withCommand = event.metaKey || event.ctrlKey
  if (withCommand && event.key.toLowerCase() === 's') return 'save'
  // 表单里的 Esc 不吃：由装载层把焦点收走（= 退出输入），选中与手势都不动
  if (event.key === 'Escape') return formFocused ? null : 'escape'
  if (formFocused) return null
  return withCommand ? commandActionOf(event) : plainActionOf(event)
}

/** 十二个动作各自的落点；一个都不许缺，缺了那个键就是按了没反应。 */
export interface Twin2dShortcutHandlers {
  save: () => void
  undo: () => void
  redo: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  duplicate: () => void
  remove: () => void
  selectAll: () => void
  /** Esc：正在进行的手势按取消收场，没手势就清选中。 */
  escape: () => void
  /** 方向键微调；位移已按栅格换算成设计像素。 */
  nudge: (at: Pt) => void
  selectTool: (tool: Twin2dTool) => void
}

export interface Twin2dShortcutOptions {
  handlers: Twin2dShortcutHandlers
  /** 取这张图的栅格步长；方向键按它步进。 */
  grid: () => number
  /** 覆盖层（帮助、确认框）打开时为真：全部手势让位，只留 Esc 关它。 */
  suspended?: () => boolean
}

/**
 * 装上键盘手势。须在 setup 内调用。
 * ⚠ window 监听用 `AbortController` 持有并在卸载时 abort：编辑器是会被切走的路由，
 * 留下的监听会在别的页面上继续吞掉撤销键。
 * @param options 落点、栅格与「暂时让位」的判定
 */
export function useTwin2dShortcuts(options: Twin2dShortcutOptions): void {
  let listeners: AbortController | null = null

  function run(action: Twin2dShortcutAction, event: KeyboardEvent): void {
    const { handlers } = options
    if (action === 'nudge') {
      const at = twin2dNudgeOf(event, options.grid())
      if (at !== null) handlers.nudge(at)
      return
    }
    if (action === 'selectTool') {
      const tool = twin2dToolOf(event.key)
      if (tool !== null) handlers.selectTool(tool)
      return
    }
    handlers[action]()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (options.suspended?.() === true) {
      if (event.key === 'Escape') options.handlers.escape()
      return
    }
    const formFocused = isTwin2dFormFocused()
    // 表单里的 Esc = 退出输入焦点：这里只把焦点收走，判定层已经让位
    if (event.key === 'Escape' && formFocused) {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      return
    }
    const action = twin2dShortcutOf(event, formFocused)
    if (action === null) return
    event.preventDefault()
    run(action, event)
  }

  onMounted(() => {
    listeners = new AbortController()
    window.addEventListener('keydown', onKeyDown, { signal: listeners.signal })
  })

  onUnmounted(() => {
    listeners?.abort()
    listeners = null
  })
}
