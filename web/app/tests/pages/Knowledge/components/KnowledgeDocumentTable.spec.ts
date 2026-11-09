/** @fileoverview 文档表：待处理行带的重试提示按提示显示，失败原因才标红。 */
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'

import type { KnowledgeDocument } from '@/api/knowledge'
import KnowledgeDocumentTable from '@/pages/Knowledge/components/KnowledgeDocumentTable.vue'

enableAutoUnmount(afterEach)

function document(changes: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: 'd1',
    title: '锅炉手册.pdf',
    status: 'pending',
    failureReason: '',
    chunkCount: 0,
    sizeBytes: 1024,
    hasRaw: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: null,
    ...changes,
  }
}

function reasonOf(row: KnowledgeDocument) {
  const wrapper = mount(KnowledgeDocumentTable, {
    props: { documents: [row], loading: false },
    global: { plugins: [createPinia()] },
  })
  const found = wrapper
    .findAll('span')
    .find((span) => span.text() === row.failureReason)
  if (found === undefined) throw new Error('行里没有那句原因')
  return found
}

describe('行内原因', () => {
  it('待处理行的重试提示照常显示，但不按失败标红', () => {
    const hint = reasonOf(
      document({ failureReason: '原件暂时取不到，稍后自动重试' }),
    )
    expect(hint.classes()).not.toContain('text-state-danger')
  })

  it('失败行的原因标红', () => {
    const reason = reasonOf(
      document({ status: 'failed', failureReason: '认不出 .pdf 是什么格式' }),
    )
    expect(reason.classes()).toContain('text-state-danger')
  })
})
