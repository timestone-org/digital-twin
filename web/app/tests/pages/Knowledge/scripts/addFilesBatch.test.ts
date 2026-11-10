/** @fileoverview 一批上传：重复的那份记作跳过，不拦后面的文件，最后说清是哪几份。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/knowledge'
import { BizError } from '@/api/client'
import type { KnowledgeDocument } from '@/api/knowledge'
import { useKnowledgePage } from '@/pages/Knowledge/scripts/useKnowledgePage'

function documentOf(id: string): KnowledgeDocument {
  return {
    id,
    title: id,
    status: 'pending',
    failureReason: '',
    chunkCount: 0,
    sizeBytes: 1,
    hasRaw: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: null,
  }
}

beforeEach(() => {
  vi.spyOn(api, 'listDocuments').mockResolvedValue([])
  vi.spyOn(api, 'readBase').mockRejectedValue(new Error('不关心'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('addFiles 一批', () => {
  it('第一份重复时照传后面的，汇总里点名跳过的那份', async () => {
    const upload = vi
      .spyOn(api, 'uploadDocument')
      .mockRejectedValueOnce(
        new BizError(42308, '这份内容已经在这个库里了', 409, 't'),
      )
      .mockResolvedValueOnce(documentOf('d2'))
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'

    const uploaded = await page.addFiles([
      new File(['a'], '巡检要点.txt'),
      new File(['b'], '交接班制度.txt'),
    ])

    expect(upload).toHaveBeenCalledTimes(2)
    expect(uploaded).toBe(1)
    expect(page.error.value).toContain('跳过 1 份重复：巡检要点.txt')
  })
})
