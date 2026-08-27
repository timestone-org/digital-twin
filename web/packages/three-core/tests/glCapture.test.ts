/**
 * @fileoverview 守快照登记处的契约：按根筛快照源、注销即消失、
 * 内核快照「先画一帧再拷」、任何一步失败给 null 而不是抛——
 * 截图方靠最后这条保证整张截图不因一块 3D 跟着失败。
 * 替身那条守的是「截图不留痕」——替身留在 DOM 里的话，
 * 画面上会多出一张不再更新的假画布。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetGlSnapshots,
  glSnapshotsWithin,
  registerCoreSnapshot,
  registerGlSnapshot,
  snapshotSceneCore,
  withGlSubstitutes,
} from '../src/glCapture'
import { createSceneCore, disposeScene, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'

/** 挂在某个根下的一处假快照源。 */
function sourceUnder(root: HTMLElement) {
  const host = document.createElement('canvas')
  root.append(host)
  return { host, snapshot: () => null }
}

function createCore(): { core: SceneCore; container: HTMLDivElement } {
  const container = document.createElement('div')
  const core = createSceneCore({
    container,
    renderer: createHeadlessRenderer(),
  })
  return { core, container }
}

/** happy-dom 没有画布实现，2D 上下文靠桩给。 */
function stubContext2d(): { drawImage: ReturnType<typeof vi.fn> } {
  const context = { drawImage: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  return context
}

afterEach(() => {
  __resetGlSnapshots()
  vi.restoreAllMocks()
})

describe('登记与筛选', () => {
  it('只给出截图根下面的快照源', () => {
    const rootA = document.createElement('div')
    const rootB = document.createElement('div')
    const inA = sourceUnder(rootA)

    registerGlSnapshot(inA)
    registerGlSnapshot(sourceUnder(rootB))

    expect(glSnapshotsWithin(rootA).map((one) => one.host)).toEqual([inA.host])
    expect(glSnapshotsWithin(rootB)).toHaveLength(1)
  })

  it('注销后就找不到了，重复注销也不出事', () => {
    const root = document.createElement('div')
    const unregister = registerGlSnapshot(sourceUnder(root))

    unregister()
    unregister()

    expect(glSnapshotsWithin(root)).toHaveLength(0)
  })
})

describe('内核快照', () => {
  it('先画一帧，再拷进一张同尺寸的 2D 画布', () => {
    const { core } = createCore()
    const context = stubContext2d()

    const copy = snapshotSceneCore(core)

    // 先画一帧再取：WebGL 的后备缓冲在下一帧就被清了
    const renderer = core.renderer as ReturnType<typeof createHeadlessRenderer>
    expect(renderer.renders).toHaveLength(1)
    expect(copy?.width).toBe(core.renderer.domElement.width)
    expect(copy?.height).toBe(core.renderer.domElement.height)
    expect(context.drawImage).toHaveBeenCalledWith(
      core.renderer.domElement,
      0,
      0,
    )
    disposeScene(core)
  })

  it('渲染那一步抛了就给 null，不把异常漏出去', () => {
    const { core } = createCore()
    stubContext2d()
    core.renderer.render = () => {
      throw new Error('context lost')
    }

    expect(snapshotSceneCore(core)).toBeNull()
    disposeScene(core)
  })

  it('拿不到 2D 上下文也给 null', () => {
    const { core } = createCore()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(snapshotSceneCore(core)).toBeNull()
    disposeScene(core)
  })

  it('画布此刻没有尺寸也给 null', () => {
    const { core } = createCore()
    stubContext2d()
    core.renderer.domElement.width = 0

    expect(snapshotSceneCore(core)).toBeNull()
    disposeScene(core)
  })
})

describe('WebGL 替身', () => {
  /** 往根下挂一张带内联样式的 WebGL 画布，登记成快照源。 */
  function glHostIn(
    root: HTMLElement,
    snapshot: () => HTMLCanvasElement | null,
  ): HTMLCanvasElement {
    const host = document.createElement('canvas')
    host.style.cssText = 'position: absolute; inset: 0px; width: 100%;'
    root.append(host)
    registerGlSnapshot({ host, snapshot })
    return host
  }

  it('替身照抄本体的内联样式，跑完恢复原状', async () => {
    const root = document.createElement('div')
    const copy = document.createElement('canvas')
    const host = glHostIn(root, () => copy)

    await withGlSubstitutes(root, () => {
      // 此刻替身顶着 WebGL 画布：本体隐身、替身是它的下一个兄弟
      expect(host.style.visibility).toBe('hidden')
      expect(host.nextSibling).toBe(copy)
      expect(copy.style.position).toBe('absolute')
      expect(copy.style.width).toBe('100%')
      return Promise.resolve('ok')
    })

    expect(root.contains(copy)).toBe(false)
    expect(host.style.visibility).toBe('')
  })

  it('run 抛出时也把替身摘掉、本体放回来', async () => {
    const root = document.createElement('div')
    const copy = document.createElement('canvas')
    const host = glHostIn(root, () => copy)

    await expect(
      withGlSubstitutes(root, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow(/boom/)

    expect(root.contains(copy)).toBe(false)
    expect(host.style.visibility).toBe('')
  })

  it('快照给 null 的那一处保持原状，不隐藏本体', async () => {
    const root = document.createElement('div')
    const host = glHostIn(root, () => null)

    await withGlSubstitutes(root, () => {
      // 宁可这一块空白，也不能让整张截图失败
      expect(host.style.visibility).toBe('')
      expect(root.children).toHaveLength(1)
      return Promise.resolve('ok')
    })

    expect(root.children).toHaveLength(1)
  })

  it('根之外的快照源一概不碰', async () => {
    const elsewhere = document.createElement('div')
    const copy = document.createElement('canvas')
    const host = glHostIn(elsewhere, () => copy)

    await withGlSubstitutes(document.createElement('div'), () => {
      expect(host.style.visibility).toBe('')
      expect(elsewhere.contains(copy)).toBe(false)
      return Promise.resolve('ok')
    })
  })
})

describe('内核登记', () => {
  it('createSceneCore 建好即登记，disposeScene 即注销', () => {
    const { core, container } = createCore()

    expect(glSnapshotsWithin(container).map((one) => one.host)).toEqual([
      core.renderer.domElement,
    ])

    disposeScene(core)
    expect(glSnapshotsWithin(container)).toHaveLength(0)
  })

  it('重复登记同一内核不出双份', () => {
    const { core, container } = createCore()
    registerCoreSnapshot(core)

    expect(glSnapshotsWithin(container)).toHaveLength(1)
    disposeScene(core)
  })
})
