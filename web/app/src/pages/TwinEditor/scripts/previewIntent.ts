/** @fileoverview 属性字段将当前配置意图传给预览工作面。 */
import type { InjectionKey } from 'vue'
export const TWIN_PREVIEW_INTENT: InjectionKey<
  (mode: 'detail' | 'click') => void
> = Symbol('twin-preview-intent')
