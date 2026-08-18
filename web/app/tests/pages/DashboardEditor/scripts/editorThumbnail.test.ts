/**
 * @fileoverview 保存后截缩略图的契约。
 * ⚠ 舞台身上带着编辑器的缩放（`transform: scale()`），而截图库克隆节点时会把计算
 * 样式原样复制过去——不把它打成 none，画出来的就是「内容缩在左上角、四周一大片空」。
 * ⚠ 截图是锦上添花：任何失败都只能返回 false，不许把保存流程带挂。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toPng =
  vi.fn<
    (node: HTMLElement, options: Record<string, unknown>) => Promise<string>
  >()
const saveDashboardThumbnail =
  vi.fn<(id: string, dataUrl: string) => Promise<void>>()

vi.mock('html-to-image', () => ({ toPng }))
vi.mock('@/api/dashboardThumbnail', () => ({ saveDashboardThumbnail }))

const { captureThumbnail } =
  await import('@/pages/DashboardEditor/scripts/editorThumbnail')

/** 造一个设计尺寸 1920 宽、正带着适应窗口缩放的舞台。 */
function stageEl(width = 1920, scale = 0.47): HTMLElement {
  const el = document.createElement('div')
  el.style.transform = `scale(${scale})`
  el.style.transformOrigin = 'top left'
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true })
  return el
}

/** 这一次截图交给库的选项。 */
function options(): Record<string, unknown> {
  return toPng.mock.calls.at(-1)?.[1] ?? {}
}

beforeEach(() => {
  toPng.mockReset()
  saveDashboardThumbnail.mockReset()
  toPng.mockResolvedValue('data:image/png;base64,AA')
  saveDashboardThumbnail.mockResolvedValue()
})

describe('captureThumbnail', () => {
  it('⚠ 把舞台的缩放打成 none：留着它内容只占画面左上角一小块', async () => {
    await captureThumbnail('d1', stageEl())

    expect(options().style).toEqual({ transform: 'none' })
  })

  it('输出宽度按设计宽度折算，缩放不参与', async () => {
    await captureThumbnail('d1', stageEl(1920))

    expect(options().pixelRatio).toBeCloseTo(640 / 1920)
  })

  it('截到的图交给缩略图接口', async () => {
    await captureThumbnail('d1', stageEl())

    expect(saveDashboardThumbnail).toHaveBeenCalledWith(
      'd1',
      'data:image/png;base64,AA',
    )
  })

  it('舞台还没挂上就跳过，不去打接口', async () => {
    expect(await captureThumbnail('d1', null)).toBe(false)
    expect(toPng).not.toHaveBeenCalled()
  })

  it('量不到宽度时跳过：pixelRatio 会算成除零', async () => {
    expect(await captureThumbnail('d1', stageEl(0))).toBe(false)
    expect(toPng).not.toHaveBeenCalled()
  })

  it('⚠ 截图失败只返回 false：让一个装饰把保存流程弄挂才是灾难', async () => {
    toPng.mockRejectedValue(new Error('canvas 炸了'))

    expect(await captureThumbnail('d1', stageEl())).toBe(false)
  })

  it('上传失败同样只返回 false', async () => {
    saveDashboardThumbnail.mockRejectedValue(new Error('502'))

    expect(await captureThumbnail('d1', stageEl())).toBe(false)
  })
})
