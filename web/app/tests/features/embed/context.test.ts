/**
 * @fileoverview 嵌入文档状态的主题收敛与内存边界。
 * 未知主题必须回落默认，激活和报错都不能接触持久化存储。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME_ID } from '@dt/tokens'

import {
  activateEmbed,
  normalizeEmbedTheme,
  resetEmbedContext,
  showEmbedError,
  useEmbedContext,
} from '@/features/embed/context'

beforeEach(() => {
  resetEmbedContext()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetEmbedContext()
})

describe('embed context', () => {
  it('只接受已登记主题，未知值与重复 query 形状回落默认', () => {
    expect(normalizeEmbedTheme('emerald')).toBe('emerald')
    expect(normalizeEmbedTheme('no-such-theme')).toBe(DEFAULT_THEME_ID)
    expect(normalizeEmbedTheme(['emerald'])).toBe(DEFAULT_THEME_ID)
    expect(normalizeEmbedTheme(null)).toBe(DEFAULT_THEME_ID)
  })

  it('激活与错误只改内存状态，不读写 storage', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const remove = vi.spyOn(Storage.prototype, 'removeItem')

    activateEmbed('light')
    showEmbedError('失效')

    expect(useEmbedContext().isEmbedded.value).toBe(true)
    expect(useEmbedContext().themeId.value).toBe('light')
    expect(useEmbedContext().error.value).toBe('失效')
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})
