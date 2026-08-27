/**
 * @fileoverview 契约：截图交给助手的是**裸的 dataUrl 串**、截不到必须抛，
 * 以及开拍那一刻 WebGL 替身已就位（替身本身的契约在 three-core 的
 * glCapture 测试里守）。
 *
 * 前两条都是静默失效型的：包一层对象的话服务端按前缀认不出它是图；截不到时
 * 静默给空串的话，助手会对着一张它以为存在的图开始点评版面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetGlSnapshots,
  registerGlSnapshot,
} from '@dt/three-core/glCapture'

import { captureCanvas } from '@/features/ai/captureWithGl'

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
