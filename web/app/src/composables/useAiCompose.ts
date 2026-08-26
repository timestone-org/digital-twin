/**
 * @fileoverview 助手输入区的状态：草稿与待发附件。
 *
 * ⚠ 由 useAiPanel 持有而不是输入组件自己造：面板收起就卸载，敲了一半的话
 * 不能跟着没。写入走方法而不是直接改 ref：组件拿到的是 prop，直改 prop
 * 深处是被禁的写法。
 */
import { ref, type Ref } from 'vue'

import type { PendingAttachment } from '@/features/ai/attachment'

/** 输入区还没发出去的东西。 */
export interface ComposeState {
  draft: Ref<string>
  attachments: Ref<PendingAttachment[]>
  setDraft: (text: string) => void
  setAttachments: (list: PendingAttachment[]) => void
}

/** 造一份输入区状态。测试也用它，不许各自手搓一份形状不齐的。 */
export function newComposeState(): ComposeState {
  const draft = ref('')
  const attachments = ref<PendingAttachment[]>([])
  return {
    draft,
    attachments,
    setDraft: (text) => {
      draft.value = text
    },
    setAttachments: (list) => {
      attachments.value = list
    },
  }
}
