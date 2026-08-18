/**
 * @fileoverview 视口这一路的动作：两段式拾取、取当前机位、试飞漫游。
 *
 * ⚠ 拾取必须先记下「写回谁」：不记的话视口只知道用户点了哪个东西，
 * 不知道那一下是给谁点的，落下去就会改到别的实体上。
 */
import {
  normalizeTwinConfig,
  type TwinConfig,
  type Vec3,
} from '@dt/twin-config'
import { describe, expect, it, vi } from 'vitest'

import {
  createTwinViewportOps,
  type TwinViewportHandle,
} from '@/pages/TwinEditor/scripts/twinViewportOps'
import type { TwinEditorActions } from '@/pages/TwinEditor/scripts/twinEditorActions'
import {
  TWIN_SELECT_MODEL,
  type TwinSelection,
} from '@/pages/TwinEditor/scripts/types'

const CONFIG = normalizeTwinConfig({
  parts: [{ id: 'part-1', nodes: ['pump'] }],
  hierNodes: [{ id: 'h1' }],
  cameras: [{ id: 'c1' }],
})

function pose(): { position: Vec3; target: Vec3; fov: number } {
  return { position: [1, 2, 3], target: [0, 0, 0], fov: 50 }
}

function fakeHandle(overrides: Partial<TwinViewportHandle> = {}) {
  return {
    focus: vi.fn(),
    snapshot: vi.fn(pose),
    playRoamPreview: vi.fn(() => true),
    stopRoamPreview: vi.fn(),
    ...overrides,
  }
}

function setup(selection: TwinSelection = { kind: 'parts', id: 'part-1' }) {
  const patchConfig = vi.fn()
  const onRoamUnavailable = vi.fn()
  const config: { value: TwinConfig | null } = { value: CONFIG }
  const actions = { patchConfig } as unknown as TwinEditorActions
  const ops = createTwinViewportOps({
    config: () => config.value,
    actions: () => actions,
    selection: () => selection,
    onRoamUnavailable,
  })
  const handle = fakeHandle()
  ops.viewportRef.value = handle
  return { ops, patchConfig, onRoamUnavailable, handle, config }
}

describe('两段式拾取', () => {
  it('没请求过拾取时，视口回来的那一下什么都不改', () => {
    const { ops, patchConfig } = setup()

    ops.onPickNode('pump')

    expect(patchConfig).not.toHaveBeenCalled()
  })

  it('拾取节点名落到请求它的那个部件上', () => {
    const { ops, patchConfig } = setup()

    ops.requestPick('node')
    ops.onPickNode('tank')

    expect(patchConfig).toHaveBeenCalledWith({
      parts: [
        expect.objectContaining({ id: 'part-1', nodes: ['pump', 'tank'] }),
      ],
    })
  })

  it('同一个节点点两次不塞两条进去', () => {
    const { ops, patchConfig } = setup()

    ops.requestPick('node')
    ops.onPickNode('pump')

    expect(patchConfig).toHaveBeenCalledWith({
      parts: [expect.objectContaining({ nodes: ['pump'] })],
    })
  })

  it('落完一次就结束，第二下不再写回去', () => {
    const { ops, patchConfig } = setup()

    ops.requestPick('node')
    ops.onPickNode('tank')
    ops.onPickNode('valve')

    expect(patchConfig).toHaveBeenCalledTimes(1)
  })

  it('单例段（没有 id）请求不了拾取', () => {
    const { ops } = setup(TWIN_SELECT_MODEL)

    ops.requestPick('position')

    expect(ops.pickMode.value).toBeNull()
    expect(ops.isPicking.value).toBe(false)
  })

  it('取消之后视口回来的那一下不落', () => {
    const { ops, patchConfig } = setup()

    ops.requestPick('position')
    ops.cancelPick()
    ops.onPickPosition([1, 1, 1])

    expect(patchConfig).not.toHaveBeenCalled()
  })

  it('实体在拾取途中被删掉时什么都不改', () => {
    const { ops, patchConfig, config } = setup()

    ops.requestPick('node')
    config.value = normalizeTwinConfig({ parts: [] })
    ops.onPickNode('tank')

    expect(patchConfig).not.toHaveBeenCalled()
  })
})

describe('取当前机位', () => {
  it('存进视点', () => {
    const { ops, patchConfig } = setup()

    ops.captureCamera('c1')

    expect(patchConfig).toHaveBeenCalledWith({
      cameras: [expect.objectContaining({ id: 'c1', fov: 50 })],
    })
  })

  it('存进钻取节点的取景快照', () => {
    const { ops, patchConfig } = setup()

    ops.captureHierView('h1')

    expect(patchConfig).toHaveBeenCalledWith({
      hierNodes: [
        expect.objectContaining({
          id: 'h1',
          view: expect.objectContaining({ fov: 50 }),
        }),
      ],
    })
  })

  it('视口还没挂上时什么都不改', () => {
    const { ops, patchConfig } = setup()
    ops.viewportRef.value = null

    ops.captureCamera('c1')

    expect(patchConfig).not.toHaveBeenCalled()
  })
})

describe('漫游预览', () => {
  // 飞不起来就直说，不留一个按了没反应的按钮
  it('站点不够时报出来', () => {
    const { ops, onRoamUnavailable } = setup()
    ops.viewportRef.value = fakeHandle({ playRoamPreview: () => false })

    ops.previewRoam()

    expect(onRoamUnavailable).toHaveBeenCalledTimes(1)
  })

  it('飞得起来就不报', () => {
    const { ops, onRoamUnavailable } = setup()

    ops.previewRoam()

    expect(onRoamUnavailable).not.toHaveBeenCalled()
  })

  it('停预览转给视口', () => {
    const { ops, handle } = setup()

    ops.stopRoamPreview()

    expect(handle.stopRoamPreview).toHaveBeenCalledTimes(1)
  })

  it('取景转给视口', () => {
    const { ops, handle } = setup()

    ops.focus(TWIN_SELECT_MODEL)

    expect(handle.focus).toHaveBeenCalledWith(TWIN_SELECT_MODEL)
  })
})
