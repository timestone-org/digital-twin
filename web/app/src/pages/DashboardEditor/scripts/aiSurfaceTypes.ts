/**
 * @fileoverview 助手工作面要握的那几样句柄。
 * 单独一个文件是为了让绑点与组态两半互不 import——它们只共用这份形状。
 */
import type { GetModuleManifest } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { SaveOutcome } from '@/features/ai/saveTool'
import type { ReadPointSample } from '@/runtime/bindingReader'
import type { ArrangeActions } from './editorArrange'
import type { EditorActions } from './editorActions'
import type { EditorChrome } from './useEditorChrome'

/** 绑点与改配置要的那几样。 */
export interface EditorSurfaceDeps {
  editor: DashboardEditor
  actions: EditorActions
  getManifest: GetModuleManifest
}

/**
 * 元数据轴那一小片：整屏外观缺省与联动规则的读写口。
 * ⚠ 只取这四格而不是整个 `EditorChrome`：吸附与栅格是编辑器自己的偏好，
 * 助手碰它没有任何用户能看见的效果。
 */
export type MetaChrome = Pick<
  EditorChrome,
  'card' | 'rules' | 'setCard' | 'setInteractions'
>

/** 整屏外观与联动那两半握的东西。 */
export interface MetaSurfaceDeps extends EditorSurfaceDeps {
  chrome: MetaChrome
}

/** 组态还要排布动作；看图还要画布舞台那个元素。 */
export interface ComposeDeps extends EditorSurfaceDeps {
  arrange: ArrangeActions
  /** 画布舞台元素；还没挂载时给 null。 */
  stageEl: () => HTMLElement | null
}

/** 读值与落库还要这三样。 */
export interface EditorToolDeps extends ComposeDeps, MetaSurfaceDeps {
  /**
   * 画布渲染用的那份快照缓存。
   * ⚠ 助手不许另发一次请求：另发的话会出现「助手说有值、画面上是占位符」。
   */
  readSample: ReadPointSample
  /** 页面**现有**的保存路径。⚠ 不许另写一套：双轴保存的顺序不变量只有那份是对的。 */
  save: () => Promise<SaveOutcome>
  /** 此刻落库的行版本；还没加载出来时给 null。 */
  savedVersion: () => number | null
}
