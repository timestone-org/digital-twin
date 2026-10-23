/** @fileoverview 参数草稿切换确认与可保存定义的边界。 */
import { useConfirm } from '@dt/ui'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useConfigDraft } from '@/pages/Modeling/Canvas/scripts/useConfigDraft'

afterEach(async () => {
  useConfirm().resolve(false)
  await flushPromises()
})

describe('参数草稿状态', () => {
  it('已进入图的未完成配置仍可保存为定义', () => {
    const node = ref<string | null>('n1')
    const draft = useConfigDraft(node)
    draft.setStatus({ message: '数据台账：这一项必须填', hasDraft: false })
    expect(draft.blockReason.value).toBe('')
    draft.close()
    expect(node.value).toBeNull()
    expect(useConfirm().pending.value).toBeNull()
  })

  it('切换节点取消后保留草稿，明确丢弃后才切换', async () => {
    const node = ref<string | null>('n1')
    const draft = useConfigDraft(node)
    draft.setStatus({ message: '', hasDraft: true })
    expect(draft.blockReason.value).toContain('尚未应用')
    draft.open('n2')
    useConfirm().resolve(false)
    await flushPromises()
    expect(node.value).toBe('n1')
    expect(draft.hasDraft.value).toBe(true)
    draft.open('n2')
    useConfirm().resolve(true)
    await flushPromises()
    expect(node.value).toBe('n2')
    expect(draft.blockReason.value).toBe('')
  })

  it('已离开的确认回执不会重新打开旧节点', async () => {
    const node = ref<string | null>('n1')
    const draft = useConfigDraft(node)
    draft.setStatus({ message: '无效列表', hasDraft: true })
    draft.open('n2')
    draft.open('n3')
    draft.discard()
    useConfirm().resolve(true)
    await flushPromises()
    expect(node.value).toBeNull()
    expect(draft.hasDraft.value).toBe(false)
  })
})
