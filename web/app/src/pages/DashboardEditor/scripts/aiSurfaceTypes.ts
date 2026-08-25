/**
 * @fileoverview 助手工作面要握的那几样句柄。
 * 单独一个文件是为了让绑点与组态两半互不 import——它们只共用这份形状。
 */
import type { GetModuleManifest } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { ArrangeActions } from './editorArrange'
import type { EditorActions } from './editorActions'

/** 绑点与改配置要的那几样。 */
export interface EditorSurfaceDeps {
  editor: DashboardEditor
  actions: EditorActions
  getManifest: GetModuleManifest
}

/** 组态还要排布动作。 */
export interface ComposeDeps extends EditorSurfaceDeps {
  arrange: ArrangeActions
}
