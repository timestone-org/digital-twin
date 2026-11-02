/** @fileoverview 旧布局偏好仅迁移一次，存储损坏或禁用不阻断编辑器。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateLegacyEditorLayout } from '@/features/workspace/legacyEditorLayout'

const options = {
  previousKey: 'old-editor',
  nextKey: 'new-editor',
  paneIds: ['left', 'canvas', 'right'],
} as const
const targetKey = 'new-editor.horizontal.left,canvas,right'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('编辑器布局偏好迁移', () => {
  it('保留两侧宽度偏好和旧键，画布获得剩余份额', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    const original = JSON.stringify({ left: 300, right: 400 })
    localStorage.setItem(options.previousKey, original)
    migrateLegacyEditorLayout(options)
    expect(JSON.parse(localStorage.getItem(targetKey) ?? 'null')).toEqual({
      left: 300,
      canvas: 776,
      right: 400,
    })
    expect(localStorage.getItem(options.previousKey)).toBe(original)
  })

  it('已有新偏好时不覆盖，旧记录部分字段非法时采用默认值', () => {
    localStorage.setItem(options.previousKey, '{"left":-1,"right":"400"}')
    migrateLegacyEditorLayout(options)
    const migrated: unknown = JSON.parse(
      localStorage.getItem(targetKey) ?? 'null',
    )
    expect(migrated).toMatchObject({ left: 240, right: 320 })
    localStorage.setItem(options.previousKey, '{"left":500,"right":600}')
    migrateLegacyEditorLayout(options)
    expect(JSON.parse(localStorage.getItem(targetKey) ?? 'null')).toEqual(
      migrated,
    )
  })

  it.each([null, 'null', '[]', '{bad json'])(
    '旧记录 %s 不生成新偏好',
    (raw) => {
      if (raw !== null) localStorage.setItem(options.previousKey, raw)
      migrateLegacyEditorLayout(options)
      expect(localStorage.getItem(targetKey)).toBeNull()
    },
  )

  it('存储不可用时不抛异常', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(() => migrateLegacyEditorLayout(options)).not.toThrow()
  })
})
