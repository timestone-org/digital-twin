/**
 * @fileoverview 契约：截图交给助手的是**裸的 dataUrl 串**、截不到必须抛，
 * 以及 WebGL 替身在截图期间就位、截完必恢复（run 抛了也要恢复）。
 *
 * 前两条都是静默失效型的：包一层对象的话服务端按前缀认不出它是图；截不到时
 * 静默给空串的话，助手会对着一张它以为存在的图开始点评版面。替身那条守的是
 * 「截图不留痕」——替身留在 DOM 里的话，画面上会多出一张不再更新的假画布。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetGlSnapshots,
  registerGlSnapshot,
} from '@dt/three-core/glCapture'

import { captureCanvas, withGlSubstitutes } from '@/features/ai/captureWithGl'

const toPng = vi.hoisted(() => vi.fn())

vi.mock('html-to-image', () => ({ toPng }))

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function stage(width: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'offsetWidth', { value: width })
  return element
}

/** 往舞台里挂一张带内联样式的 WebGL 画布，登记成快照源。 */
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

function substitute(): HTMLCanvasElement {
  return document.createElement('canvas')
}

beforeEach(() => {
  toPng.mockReset()
  toPng.mockResolvedValue(PNG)
})

afterEach(() => {
  __resetGlSnapshots()
})

describe('截画布', () => {
  it('交出去的是裸的 dataUrl 串', async () => {
    const got = await captureCanvas(stage(1920))
    expect(got).toBe(PNG)
  })

  it('把舞台上的缩放摘掉再截', async () => {
    await captureCanvas(stage(1920))
    // 留着它，画布仍是设计尺寸而内容只画在左上角那一小块
    expect(toPng.mock.calls[0]?.[1]).toMatchObject({
      style: { transform: 'none' },
    })
  })

  it('不放大：舞台比出图宽度窄时按原尺寸出', async () => {
    await captureCanvas(stage(640))
    const options = toPng.mock.calls[0]?.[1] as { pixelRatio: number }
    expect(options.pixelRatio).toBe(1)
  })

  it('还没挂载就抛，不给一张空图', async () => {
    await expect(captureCanvas(null)).rejects.toThrow(/截不到/)
  })

  it('舞台此刻没有宽度也抛', async () => {
    await expect(captureCanvas(stage(0))).rejects.toThrow(/截不到/)
  })

  it('截图库自己失败时如实抛出去', async () => {
    toPng.mockRejectedValue(new Error('canvas tainted'))
    await expect(captureCanvas(stage(1920))).rejects.toThrow(/canvas tainted/)
  })

  it('截图库开拍那一刻替身已就位', async () => {
    const root = stage(1920)
    const copy = substitute()
    const host = glHostIn(root, () => copy)
    toPng.mockImplementation(() => {
      // 此刻替身顶着 WebGL 画布：本体隐身、替身是它的下一个兄弟
      expect(host.style.visibility).toBe('hidden')
      expect(host.nextSibling).toBe(copy)
      return Promise.resolve(PNG)
    })

    await captureCanvas(root)

    expect(toPng).toHaveBeenCalledTimes(1)
    expect(root.contains(copy)).toBe(false)
  })
})

describe('WebGL 替身', () => {
  it('替身照抄本体的内联样式，跑完恢复原状', async () => {
    const root = stage(1920)
    const copy = substitute()
    const host = glHostIn(root, () => copy)

    await withGlSubstitutes(root, () => {
      expect(copy.style.position).toBe('absolute')
      expect(copy.style.width).toBe('100%')
      return Promise.resolve('ok')
    })

    expect(root.contains(copy)).toBe(false)
    expect(host.style.visibility).toBe('')
  })

  it('run 抛出时也把替身摘掉、本体放回来', async () => {
    const root = stage(1920)
    const copy = substitute()
    const host = glHostIn(root, () => copy)

    await expect(
      withGlSubstitutes(root, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow(/boom/)

    expect(root.contains(copy)).toBe(false)
    expect(host.style.visibility).toBe('')
  })

  it('快照给 null 的那一处保持原状，不隐藏本体', async () => {
    const root = stage(1920)
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
    const copy = substitute()
    const host = glHostIn(elsewhere, () => copy)

    await withGlSubstitutes(stage(1920), () => {
      expect(host.style.visibility).toBe('')
      expect(elsewhere.contains(copy)).toBe(false)
      return Promise.resolve('ok')
    })
  })
})
