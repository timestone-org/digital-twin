/**
 * @fileoverview 2D 孪生工作面要握的那几样句柄。
 * 单独一个文件是为了让绑点那一半与工作面本体互不 import——它们只共用这份形状。
 */
import type { BindingPayload } from '@dt/contracts'
import type { Twin2dConfig } from '@dt/twin2d'

import type { SaveOutcome } from '@/features/ai/saveTool'
import type { ReadPointSample } from '@/runtime/bindingReader'

import type { Twin2dEditorSelection } from './editorSelection'

export interface Twin2dSurfaceDeps {
  /** 归一化后的 2D 孪生配置；还没读出来时给 null。 */
  config: () => Twin2dConfig | null
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: () => readonly BindingPayload[]
  /** 写一条绑定。⚠ 走页面那一支：它按 fieldKey 原地替换并沿用旧的绑定 id。 */
  write: (binding: BindingPayload) => void
  /** 解一条绑定。⚠ 换点位别用它——直接重写那一条，绑定 id 要沿用。 */
  drop: (fieldKey: string) => void
  /** 这段孪生所在的大屏节点 id；新建的绑定挂在它上面。 */
  nodeId: () => string
  /** 那个节点在大屏画布上叫什么。 */
  nodeLabel: () => string
  moduleType: () => string
  /**
   * 画布上那一条选中轴。
   * ⚠ 只认这一条：并行的 `styleFocus`（正在编哪份样式）不是画布选中，混进去
   * 的话，用户说「就动我选中的这几个」时会连一份样式一起改。
   */
  selection: Twin2dEditorSelection
  /**
   * 画中画渲染用的那份快照缓存。
   * ⚠ 助手不许另订一份：另订的话会出现「助手说有值、画面上是占位符」。
   */
  read: ReadPointSample
  /** 页面**现有**的保存路径。⚠ 不许另写一套：整树替换的不变量只有那份是对的。 */
  save: () => Promise<SaveOutcome>
  /** 此刻落库的行版本；还没加载出来时给 null。 */
  savedVersion: () => number | null
}
