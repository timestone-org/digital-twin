/**
 * @fileoverview 孪生工作面要握的那几样句柄。
 * 单独一个文件是为了让绑点那一半与工作面本体互不 import——它们只共用这份形状。
 */
import type { BindingPayload } from '@dt/contracts'
import type { TwinConfig } from '@dt/twin-config'

import type { SaveOutcome } from '@/features/ai/saveTool'
import type { ReadPointSample } from '@/runtime/bindingReader'

import type { TwinSelection } from './types'

export interface TwinSurfaceDeps {
  /** 归一化后的孪生配置；还没读出来时给 null。 */
  config: () => TwinConfig | null
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: () => readonly BindingPayload[]
  write: (binding: BindingPayload) => void
  /** 解一条绑定。⚠ 换点位别用它——直接重写那一条，绑定 id 要沿用。 */
  drop: (fieldKey: string) => void
  /** 这段孪生所在的大屏节点 id；新建的绑定挂在它上面。 */
  nodeId: () => string
  /** 那个节点在大屏画布上叫什么。 */
  nodeLabel: () => string
  moduleType: () => string
  /** 用户此刻在大纲里选中的那一个。 */
  selection: () => TwinSelection
  /** 3D 视口的宿主元素，截图的根；还没挂载时给 null。 */
  stage: () => HTMLElement | null
  /**
   * 视口渲染用的那份快照缓存。
   * ⚠ 助手不许另发一次请求：另发的话会出现「助手说有值、画面上是占位符」。
   */
  read: ReadPointSample
  /** 页面**现有**的保存路径。⚠ 不许另写一套：整树替换的不变量只有那份是对的。 */
  save: () => Promise<SaveOutcome>
  /** 此刻落库的行版本；还没加载出来时给 null。 */
  savedVersion: () => number | null
}
