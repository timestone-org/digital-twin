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
  parts: [{ id: 'part-1', nodes: ['pump'], click: { near: 'detail' } }],
  cameras: [{ id: 'c1' }],
})

/** 假视口量出来的距离；断言按它比对，换个数不影响任何一条用例的含义。 */
const MEASURED = 12.5

function pose(): { position: Vec3; target: Vec3; fov: number } {
  return { position: [1, 2, 3], target: [0, 0, 0], fov: 50 }
}

function fakeHandle(overrides: Partial<TwinViewportHandle> = {}) {
  return {
    focus: vi.fn(),
    snapshot: vi.fn(pose),
    measureDistance: vi.fn(() => MEASURED),
    playRoamPreview: vi.fn(() => true),
    stopRoamPreview: vi.fn(),
    stageEl: vi.fn(() => null),
    ...overrides,
  }
}

function setup(selection: TwinSelection = { kind: 'parts', id: 'part-1' }) {
  const patchConfig = vi.fn()
  const addPanelAt = vi.fn()
  const onRoamUnavailable = vi.fn()
  const config: { value: TwinConfig | null } = { value: CONFIG }
  const actions = { patchConfig, addPanelAt } as unknown as TwinEditorActions
  const ops = createTwinViewportOps({
    config: () => config.value,
    actions: () => actions,
    selection: () => selection,
    onRoamUnavailable,
  })
  const handle = fakeHandle()
  ops.viewportRef.value = handle
  return { ops, patchConfig, addPanelAt, onRoamUnavailable, handle, config }
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

describe('先点位置再落牌', () => {
  it('请求落牌后进入位置拾取，点到哪牌建在哪', () => {
    const { ops, addPanelAt, patchConfig } = setup()

    ops.requestPlacePanel()
    expect(ops.pickMode.value).toBe('position')
    expect(ops.isPlacingPanel.value).toBe(true)

    ops.onPickPosition([3, 2, 1])

    expect(addPanelAt).toHaveBeenCalledWith([3, 2, 1])
    // 落的是新牌，不许顺手改到当前选中的实体上
    expect(patchConfig).not.toHaveBeenCalled()
  })

  it('落完一次就结束，第二下不再建牌', () => {
    const { ops, addPanelAt } = setup()

    ops.requestPlacePanel()
    ops.onPickPosition([1, 1, 1])
    ops.onPickPosition([2, 2, 2])

    expect(addPanelAt).toHaveBeenCalledTimes(1)
    expect(ops.isPlacingPanel.value).toBe(false)
  })

  it('取消之后视口回来的那一下不建牌', () => {
    const { ops, addPanelAt } = setup()

    ops.requestPlacePanel()
    ops.cancelPick()
    ops.onPickPosition([1, 1, 1])

    expect(addPanelAt).not.toHaveBeenCalled()
  })

  // 落牌不依赖选中：大纲里选着模型段也照样能加牌
  it('单例段选中时也能请求落牌', () => {
    const { ops, addPanelAt } = setup(TWIN_SELECT_MODEL)

    ops.requestPlacePanel()
    ops.onPickPosition([1, 2, 3])

    expect(addPanelAt).toHaveBeenCalledWith([1, 2, 3])
  })

  it('普通位置拾取不算落牌，提示语不该换', () => {
    const { ops } = setup()

    ops.requestPick('position')

    expect(ops.isPlacingPanel.value).toBe(false)
  })
})

describe('Shift 连续选择部件节点', () => {
  it('把点选和框选结果追加到左侧当前部件并去重', () => {
    const { ops, patchConfig } = setup()

    ops.onSelectNodes(['pump', 'tank', 'valve', 'tank'])

    expect(patchConfig).toHaveBeenCalledWith({
      parts: [
        expect.objectContaining({
          id: 'part-1',
          nodes: ['pump', 'tank', 'valve'],
        }),
      ],
    })
  })

  it('左侧没有选中部件时不写回任何节点', () => {
    const { ops, patchConfig } = setup(TWIN_SELECT_MODEL)

    ops.onSelectNodes(['tank'])

    expect(patchConfig).not.toHaveBeenCalled()
  })

  it('只命中已经关联的节点时不制造空改动', () => {
    const { ops, patchConfig } = setup()

    ops.onSelectNodes(['pump', 'pump'])

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

  it('存进部件的取景快照', () => {
    const { ops, patchConfig } = setup()

    ops.capturePartView('part-1')

    expect(patchConfig).toHaveBeenCalledWith({
      parts: [
        expect.objectContaining({
          id: 'part-1',
          click: expect.objectContaining({
            view: expect.objectContaining({ fov: 50 }),
          }),
        }),
      ],
    })
  })

  // ⚠ 只发一个 view 会把远近两档的动作抹成缺省
  it('存取景不动这个部件已经配好的两档动作', () => {
    const { ops, patchConfig } = setup()

    ops.capturePartView('part-1')

    expect(patchConfig).toHaveBeenCalledWith({
      parts: [
        expect.objectContaining({
          click: expect.objectContaining({ near: 'detail' }),
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

describe('测距', () => {
  it('把参考系原样交给视口，量出来的数原样带回', () => {
    const { ops, handle } = setup()

    expect(ops.measureDistance('part-center')).toBe(MEASURED)
    expect(handle.measureDistance).toHaveBeenCalledWith('part-center')
  })

  // 视口还没挂上时按了尺子，得到的是「量不出」而不是一个 0
  it('视口句柄还没有时给 null，不拿 0 顶替', () => {
    const { ops } = setup()
    ops.viewportRef.value = null

    expect(ops.measureDistance('orbit')).toBeNull()
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
