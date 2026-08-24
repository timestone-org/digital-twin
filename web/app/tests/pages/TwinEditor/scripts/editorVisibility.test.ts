/**
 * @fileoverview 编辑视口临时显隐的契约：左栏眼睛只改本次编辑的画面，
 * 不读取也不回写右栏配置的「初始可见」。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  toggleEditorVisibility,
  withEditorVisibility,
} from '@/pages/TwinEditor/scripts/editorVisibility'

describe('编辑态显隐', () => {
  it('进入编辑器时全部显示，不受初始可见影响', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'pump', visibility: { visible: false } }],
      anchors: [{ id: 'temperature', visibility: { visible: false } }],
    })

    const editing = withEditorVisibility(config, new Set())

    expect(editing.parts[0]?.visibility.visible).toBe(true)
    expect(editing.anchors[0]?.visibility.visible).toBe(true)
    expect(config.parts[0]?.visibility.visible).toBe(false)
    expect(config.anchors[0]?.visibility.visible).toBe(false)
  })

  it('点左栏眼睛只隐藏目标，不改持久化的初始可见', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'pump', visibility: { visible: true } }],
      anchors: [{ id: 'temperature', visibility: { visible: false } }],
    })
    const hidden = toggleEditorVisibility(new Set(), {
      kind: 'parts',
      id: 'pump',
    })

    const editing = withEditorVisibility(config, hidden)

    expect(editing.parts[0]?.visibility.visible).toBe(false)
    expect(editing.anchors[0]?.visibility.visible).toBe(true)
    expect(config.parts[0]?.visibility.visible).toBe(true)
    expect(config.anchors[0]?.visibility.visible).toBe(false)
  })

  it('再点一次恢复编辑态显示', () => {
    const target = { kind: 'parts', id: 'pump' } as const
    const hidden = toggleEditorVisibility(
      toggleEditorVisibility(new Set(), target),
      target,
    )

    expect(hidden.size).toBe(0)
  })
})
