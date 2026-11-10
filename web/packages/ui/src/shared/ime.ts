/**
 * @fileoverview 输入法组词期间的按键判定：这时的回车/Esc 是给输入法的，不是给控件的。
 */

// Safari 里 compositionend 先于 keydown 到，isComposing 已是 false，只剩 keyCode 能认出来
const IME_PROCESS_KEY_CODE = 229

/** 这次按键是否落在输入法组词期间。 */
export function isImeKeydown(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE
}
