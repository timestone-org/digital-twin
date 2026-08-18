/**
 * @fileoverview 全局快捷键的「让位」判定。
 * ⚠ 按「最近可交互祖先」而不是 activeElement.tagName：设计系统的下拉触发器是
 * `<button role="combobox">`，其方向键只 preventDefault 不 stopPropagation，
 * 只看 tagName 会在用户键盘翻选项时把画布上的选中节点静默挪走并压进撤销栈；
 * 弹窗（role="dialog"）里的一切输入同理要独占键盘。
 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="dialog"]'

export function isFormFocused(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLElement &&
    active.closest(INTERACTIVE_SELECTOR) !== null
  )
}
