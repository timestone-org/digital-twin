/**
 * @fileoverview 契约：截图交给助手的是**裸的 dataUrl 串**，且截不到必须抛。
 *
 * 两条都是静默失效型的：包一层对象的话服务端按前缀认不出它是图，那张图会被
 * 当成一段普通文字塞进工具消息里丢掉，而调用显示成功；截不到时静默给空串的话，
 * 助手会对着一张它以为存在的图开始点评版面。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { captureCanvas } from '@/pages/DashboardEditor/scripts/aiSurfaceCapture'

const toPng = vi.hoisted(() => vi.fn())

vi.mock('html-to-image', () => ({ toPng }))

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function stage(width: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'offsetWidth', { value: width })
  return element
}

beforeEach(() => {
  toPng.mockReset()
  toPng.mockResolvedValue(PNG)
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
})
