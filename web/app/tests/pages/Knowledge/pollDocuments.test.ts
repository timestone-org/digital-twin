/** @fileoverview 摄取轮询只重读文档：不抹掉页面上的错误、不重读库统计、不转刷新圈。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/knowledge'
import { useKnowledgePage } from '@/pages/Knowledge/scripts/useKnowledgePage'

beforeEach(() => {
  vi.spyOn(api, 'listDocuments').mockResolvedValue([])
  vi.spyOn(api, 'readBase')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pollDocuments', () => {
  it('保留上一次动作留下的错误，且不重读库统计', async () => {
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    page.error.value = '这份内容已经在这个库里了'
    await page.pollDocuments()
    expect(api.listDocuments).toHaveBeenCalledOnce()
    expect(api.readBase).not.toHaveBeenCalled()
    expect(page.error.value).toBe('这份内容已经在这个库里了')
  })

  it('后台轮询不转顶栏的刷新圈', async () => {
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    const running = page.pollDocuments()
    expect(page.isRefreshing.value).toBe(false)
    await running
  })
})
