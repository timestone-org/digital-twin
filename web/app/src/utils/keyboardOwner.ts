/**
 * @fileoverview 画布类页面全局快捷键的「让位」判定，三个编辑器共用这一份。
 * ⚠ 按「最近可交互祖先」而不是 tagName：设计系统的下拉触发器是
 * `<button role="combobox">`，其方向键只 preventDefault 不 stopPropagation，
 * 只看 tagName 会在用户键盘翻选项时把画布上的选中节点静默挪走并压进撤销栈；
 * 弹窗（role="dialog"）里的一切输入同理要独占键盘。
 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="dialog"]'

/**
 * 这个元素是否该独占键盘。
 * @param target 按键事件的目标或当前焦点
 */
export function ownsKeyboard(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest(INTERACTIVE_SELECTOR) !== null)
  )
}
