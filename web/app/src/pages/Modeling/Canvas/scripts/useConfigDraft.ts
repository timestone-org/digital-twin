/** @fileoverview 参数面板未应用草稿的阻止状态与显式丢弃。 */
import { useConfirm } from '@dt/ui'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'

import type { ConfigStatus } from './configValues'

export function useConfigDraft(nodeId: Ref<string | null>) {
  const confirm = useConfirm()
  const status = ref<ConfigStatus>({ message: '', hasDraft: false })
  const isConfirming = ref(false)
  const blockReason = computed(() =>
    status.value.hasDraft ? status.value.message || '参数草稿尚未应用' : '',
  )

  function select(next: string | null): void {
    nodeId.value = next
    status.value = { message: '', hasDraft: false }
  }

  async function confirmDiscard(next: string | null): Promise<void> {
    if (isConfirming.value) return
    isConfirming.value = true
    const original = nodeId.value
    try {
      const accepted = await confirm.ask({
        title: '丢弃未应用的参数草稿？',
        message:
          '参数面板有无效或尚未应用的草稿。关闭或切换节点会丢弃这些内容，已应用的配置保持不变。',
        confirmText: '丢弃草稿',
        cancelText: '继续编辑',
        danger: true,
      })
      if (accepted && nodeId.value === original) select(next)
    } finally {
      isConfirming.value = false
    }
  }

  function open(id: string): void {
    if (id === nodeId.value) return
    if (status.value.hasDraft) void confirmDiscard(id)
    else select(id)
  }

  function close(): void {
    if (status.value.hasDraft) void confirmDiscard(null)
    else select(null)
  }

  return {
    blockReason,
    open,
    close,
    hasDraft: computed(() => status.value.hasDraft),
    setStatus: (value: ConfigStatus) => {
      status.value = value
    },
    discard: () => select(null),
  }
}
