/**
 * @fileoverview 左栏眼睛关掉的实体：只属于本次编辑，不进文档、不进撤销栈，
 * 也不进运行态预览。
 */
import type { TwinConfig } from '@dt/twin-config'
import { computed, ref, watch, type ComputedRef } from 'vue'

import {
  toggleEditorVisibility,
  withEditorVisibility,
  type EditorVisibilityTarget,
} from './editorVisibility'

export interface TwinEditorHidden {
  /** 套上编辑态显隐的配置；还没读出来时是 null。 */
  config: ComputedRef<TwinConfig | null>
  toggle: (target: EditorVisibilityTarget) => void
}

/**
 * 装上编辑态显隐。须在 setup 内调用。
 * @param config 持久化文档配置；null = 还没读出来
 * @param scope 当前编辑的是哪一段孪生；它一变就清空隐藏态
 */
export function useEditorHidden(
  config: () => TwinConfig | null,
  scope: () => string,
): TwinEditorHidden {
  const hidden = ref<ReadonlySet<string>>(new Set())

  // 路由复用同一页组件时，上一段孪生的编辑隐藏态不许串到下一段。
  watch(scope, () => {
    hidden.value = new Set()
  })

  return {
    config: computed(() => {
      const current = config()
      return current === null
        ? null
        : withEditorVisibility(current, hidden.value)
    }),
    toggle: (target) => {
      hidden.value = toggleEditorVisibility(hidden.value, target)
    },
  }
}
