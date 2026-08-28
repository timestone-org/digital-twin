/**
 * @fileoverview 契约：保存失败一律**抛**，尤其是 409。
 *
 * 静默吞掉会让模型接着往下绑，而每一条都存不进去——用户最后收到一句「已完成」，
 * 画面上一个数都没变。
 */
import { describe, expect, it, vi } from 'vitest'

import { runSaveTool } from '@/features/ai/saveTool'

describe('保存工具', () => {
  it('存上了就回行版本，并说清实时推送要下一拍才认新点位', async () => {
    const found = await runSaveTool({
      save: () => Promise.resolve({ isSaved: true, message: null }),
      version: () => 12,
    })
    expect(found).toMatchObject({ ok: true, saved_version: 12 })
    expect(found.note).toContain('实时推送')
  })

  it('回执里挑明保存的是整份草稿', async () => {
    const found = await runSaveTool({
      save: () => Promise.resolve({ isSaved: true, message: null }),
      version: () => 1,
    })
    expect(found.note).toContain('整份草稿')
  })

  it('版本取不到时给 null，不编一个数出来', async () => {
    const found = await runSaveTool({
      save: () => Promise.resolve({ isSaved: true, message: null }),
      version: () => null,
    })
    expect(found.saved_version).toBeNull()
  })

  it('冲突时抛出那句冲突原因，不静默成功', async () => {
    await expect(
      runSaveTool({
        save: () =>
          Promise.resolve({ isSaved: false, message: '版本旧了，请重新加载' }),
        version: () => 3,
      }),
    ).rejects.toThrow('版本旧了，请重新加载')
  })

  it('失败又说不出原因时也抛，不留白', async () => {
    await expect(
      runSaveTool({
        save: () => Promise.resolve({ isSaved: false, message: null }),
        version: () => null,
      }),
    ).rejects.toThrow('保存失败')
  })

  it('保存路径自己抛的照原样透出去', async () => {
    await expect(
      runSaveTool({
        save: () => Promise.reject(new Error('网络断了')),
        version: () => null,
      }),
    ).rejects.toThrow('网络断了')
  })

  it('失败时不去问行版本——那时它还是旧的', async () => {
    const version = vi.fn(() => 3)
    await expect(
      runSaveTool({
        save: () => Promise.resolve({ isSaved: false, message: '冲突' }),
        version,
      }),
    ).rejects.toThrow('冲突')
    expect(version).not.toHaveBeenCalled()
  })
})
