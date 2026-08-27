/**
 * @fileoverview 手柄模式的回落规则：旋转档只留给转得动的实体——箭头，
 * 以及钉死朝向的信息牌；换成别的选中或朝向档改走时都要退回平移。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useGizmoMode } from '@/pages/TwinEditor/scripts/useGizmoMode'
import {
  TWIN_SELECT_MODEL,
  type TwinSelection,
} from '@/pages/TwinEditor/scripts/types'

function configOf(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    arrows: [{ id: 'r1' }],
    panels: [
      { id: 'fixed-1', billboard: 'fixed' },
      { id: 'face-1', billboard: 'face' },
    ],
    anchors: [{ id: 'a1' }],
    ...overrides,
  })
}

function setup(selection: TwinSelection | null = null) {
  const current = ref<TwinSelection | null>(selection)
  const config = ref<TwinConfig | null>(configOf())
  const mode = useGizmoMode(
    () => current.value,
    () => config.value,
  )
  return { current, config, mode }
}

describe('旋转档的去留', () => {
  it('选中箭头时旋转档留得住', async () => {
    const { current, mode } = setup({ kind: 'arrows', id: 'r1' })
    mode.value = 'rotate'

    current.value = { kind: 'arrows', id: 'r1' }
    await nextTick()

    expect(mode.value).toBe('rotate')
  })

  it('钉死朝向的信息牌旋转档留得住', async () => {
    const { current, mode } = setup()
    current.value = { kind: 'panels', id: 'fixed-1' }
    await nextTick()
    mode.value = 'rotate'

    current.value = { kind: 'panels', id: 'fixed-1' }
    await nextTick()

    expect(mode.value).toBe('rotate')
  })

  // ⚠ 跟随相机的牌朝向每帧被相机接管，留在旋转档上是三个转不出效果的圆环
  it('跟随相机的信息牌退回平移', async () => {
    const { current, mode } = setup({ kind: 'panels', id: 'fixed-1' })
    mode.value = 'rotate'

    current.value = { kind: 'panels', id: 'face-1' }
    await nextTick()

    expect(mode.value).toBe('translate')
  })

  it('朝向档从钉死改走时当场退回平移', async () => {
    const { current, config, mode } = setup({ kind: 'panels', id: 'fixed-1' })
    mode.value = 'rotate'

    config.value = configOf({
      panels: [
        { id: 'fixed-1', billboard: 'face' },
        { id: 'face-1', billboard: 'face' },
      ],
    })
    await nextTick()

    expect(mode.value).toBe('translate')
    expect(current.value).toEqual({ kind: 'panels', id: 'fixed-1' })
  })

  it('选中换成锚点或单例段时退回平移', async () => {
    const { current, mode } = setup({ kind: 'arrows', id: 'r1' })
    mode.value = 'rotate'

    current.value = { kind: 'anchors', id: 'a1' }
    await nextTick()
    expect(mode.value).toBe('translate')

    mode.value = 'rotate'
    current.value = TWIN_SELECT_MODEL
    await nextTick()
    expect(mode.value).toBe('translate')
  })
})
