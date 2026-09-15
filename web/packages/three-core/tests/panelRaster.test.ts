/** @fileoverview 牌面局部边界、引线与透明绘制参数契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toCanvas } from 'html-to-image'

import { panelBounds, rasterizePanel } from '../src/panelRaster'

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function mount() {
  const root = document.createElement('div')
  const card = document.createElement('div')
  Object.defineProperties(card, {
    offsetWidth: { value: 200 },
    offsetHeight: { value: 100 },
    offsetLeft: { value: 0 },
    offsetTop: { value: 0 },
  })
  card.style.transform = 'matrix(1, 0, 0, 1, -100, -50)'
  card.style.transformOrigin = '0px 0px'
  root.append(card)
  document.body.append(root)
  return { root, card }
}

describe('牌面绘制', () => {
  it('中心牌的负偏移与阴影留白保留', () => {
    const f = mount()
    expect(panelBounds(f.root)).toEqual({
      x: -116,
      y: -66,
      width: 232,
      height: 132,
    })
  })

  it('偏置卡片与锚点一起纳入边界', () => {
    const f = mount()
    f.card.style.transform = 'matrix(1, 0, 0, 1, 26, -50)'
    const anchor = document.createElement('div')
    Object.defineProperties(anchor, {
      offsetWidth: { value: 8 },
      offsetHeight: { value: 8 },
    })
    anchor.style.transform = 'none'
    anchor.style.transformOrigin = '0px 0px'
    f.root.append(
      anchor,
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      document.createElement('div'),
    )
    expect(panelBounds(f.root)).toEqual({
      x: -16,
      y: -66,
      width: 258,
      height: 132,
    })
  })

  it('未完成布局时等待，不输出空纹理', async () => {
    expect(await rasterizePanel(document.createElement('div'))).toBeNull()
  })

  it('纹理按两倍分辨率生成，挂点保持零尺寸并移入画布', async () => {
    const f = mount()
    const canvas = document.createElement('canvas')
    vi.mocked(toCanvas).mockResolvedValue(canvas)
    const result = await rasterizePanel(f.root)
    expect(result).toEqual({ canvas, x: -116, y: -66, width: 232, height: 132 })
    expect(toCanvas).toHaveBeenCalledWith(
      f.root,
      expect.objectContaining({
        pixelRatio: 2,
        width: 232,
        height: 132,
        style: expect.objectContaining({
          width: '0px',
          height: '0px',
          transform: 'translate(116px, 66px)',
          opacity: '1',
        }),
      }),
    )
  })
})
