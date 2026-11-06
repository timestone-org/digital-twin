/** @fileoverview 全局快捷键的「让位」判定，口径见 `@/utils/keyboardOwner`。 */
import { ownsKeyboard } from '@/utils/keyboardOwner'

export function isFormFocused(): boolean {
  return ownsKeyboard(document.activeElement)
}
