/**
 * @fileoverview DtSelect 的键盘语义：按键 → 动作的分派表。
 * 不用原生 `<select>` 就得自己把 listbox 的键盘契约实现完整，
 * 抽出来是为了它能被单独单元测试，而不是只能靠挂载组件敲键盘。
 */

export interface SelectKeyState {
  isOpen: boolean
  /** 有搜索框时空格是正常输入，不能拿去开合。 */
  hasSearch: boolean
  hasQuery: boolean
}

export type SelectAction =
  | { kind: 'open' }
  | { kind: 'move'; delta: number }
  | { kind: 'jump'; to: 'first' | 'last' }
  | { kind: 'pick' }
  | { kind: 'clear-query' }
  | { kind: 'toggle' }
  /** ⚠ `stop` 只在真的要关下拉时给：外层 DtModal 也监听 Esc，一律拦下
   *  会让「下拉已经关着，再按 Esc 关不掉弹窗」。 */
  | { kind: 'close'; stop: boolean }

type Resolver = (state: SelectKeyState) => SelectAction | null

const HANDLERS: Readonly<Record<string, Resolver>> = {
  ArrowDown: (state) =>
    state.isOpen ? { kind: 'move', delta: 1 } : { kind: 'open' },
  ArrowUp: (state) =>
    state.isOpen ? { kind: 'move', delta: -1 } : { kind: 'open' },
  Home: (state) => (state.isOpen ? { kind: 'jump', to: 'first' } : null),
  End: (state) => (state.isOpen ? { kind: 'jump', to: 'last' } : null),
  Enter: (state) => (state.isOpen ? { kind: 'pick' } : { kind: 'open' }),
  ' ': (state) => (state.hasSearch ? null : { kind: 'toggle' }),
  Escape: (state) => {
    if (!state.isOpen) return null
    return state.hasQuery
      ? { kind: 'clear-query' }
      : { kind: 'close', stop: true }
  },
  // ⚠ 焦点这时可能在浮层的搜索框里，而浮层马上要被卸载：不先收回触发器
  // 的话焦点会掉到 body，下一次 Tab 从页首重来，而不是走到下一个字段。
  Tab: (state) => (state.isOpen ? { kind: 'close', stop: false } : null),
}

/** 按键落在哪个动作上；不归下拉管的键返回 null，交给浏览器默认行为。 */
export function resolveKey(
  key: string,
  state: SelectKeyState,
): SelectAction | null {
  return HANDLERS[key]?.(state) ?? null
}
