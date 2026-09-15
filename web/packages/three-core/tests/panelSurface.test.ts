/** @fileoverview 牌面纹理更新、距离淡出、异步释放与失败降级契约。 */
import { flushPromises } from '@vue/test-utils'
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PanelRaster } from '../src/panelRaster'
import { PanelSurface } from '../src/panelSurface'

function raster(): PanelRaster {
  return {
    canvas: document.createElement('canvas'),
    x: -100,
    y: -60,
    width: 200,
    height: 120,
  }
}

function fixture(animated = false) {
  const label = new CSS3DObject(document.createElement('div'))
  document.body.append(label.element)
  const draw = vi
    .fn<() => Promise<PanelRaster | null>>()
    .mockResolvedValue(raster())
  const surface = new PanelSurface(label, animated, draw)
  return { label, surface, draw }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('纹理生命周期', () => {
  it('纹理生成后显示三维牌面，DOM 不叠在模型前', async () => {
    const f = fixture()
    f.surface.update(0)
    await flushPromises()
    expect(f.surface.mesh.visible).toBe(true)
    expect(f.surface.mesh.scale.toArray()).toEqual([200, 120, 1])
    expect(f.surface.mesh.position.toArray()).toEqual([0, 0, 0])
    expect(f.label.element.style.opacity).toBe('0')
    f.surface.setOpacity(0.4)
    expect(f.surface.mesh.material.opacity).toBe(0.4)
    expect(f.label.element.style.opacity).toBe('0')
    f.surface.dispose()
  })

  it('静态牌不随镜头逐帧重绘，数据刷新后替换并释放旧纹理', async () => {
    const f = fixture()
    f.surface.update(0)
    await flushPromises()
    const old = f.surface.mesh.material.map
    if (old === null) throw new Error('纹理缺失')
    const dispose = vi.spyOn(old, 'dispose')
    f.surface.update(10)
    f.surface.update(100)
    expect(f.draw).toHaveBeenCalledTimes(1)
    f.surface.invalidate()
    f.surface.update(200)
    await flushPromises()
    expect(f.draw).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledOnce()
    expect(f.surface.mesh.material.map).not.toBe(old)
    f.surface.dispose()
  })

  it('在途期间合并更新，完成后仍补画最新读数', async () => {
    const f = fixture()
    let finish: (value: PanelRaster) => void = () => {}
    f.draw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    f.surface.update(0)
    f.surface.invalidate()
    f.surface.update(200)
    expect(f.draw).toHaveBeenCalledTimes(1)
    finish(raster())
    await flushPromises()
    f.surface.update(300)
    await flushPromises()
    expect(f.draw).toHaveBeenCalledTimes(2)
    f.surface.dispose()
  })

  it('卸载后的异步结果不创建纹理，已分配资源释放', async () => {
    const f = fixture()
    let finish: (value: PanelRaster) => void = () => {}
    f.draw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const geometry = vi.spyOn(f.surface.mesh.geometry, 'dispose')
    const material = vi.spyOn(f.surface.mesh.material, 'dispose')
    f.surface.update(0)
    f.surface.dispose()
    finish(raster())
    await flushPromises()
    f.surface.update(200)
    expect(f.surface.mesh.material.map).toBeNull()
    expect(f.label.children).toHaveLength(0)
    expect(geometry).toHaveBeenCalledOnce()
    expect(material).toHaveBeenCalledOnce()
  })

  it('未挂载或隐藏的牌不绘制，布局就绪后补画', async () => {
    const f = fixture()
    f.label.element.remove()
    f.surface.update(0)
    document.body.append(f.label.element)
    f.label.visible = false
    f.surface.update(0)
    expect(f.draw).not.toHaveBeenCalled()
    f.label.visible = true
    f.draw.mockResolvedValueOnce(null)
    f.surface.update(0)
    await flushPromises()
    expect(f.surface.mesh.visible).toBe(false)
    f.surface.update(100)
    await flushPromises()
    expect(f.surface.mesh.visible).toBe(true)
    f.surface.dispose()
  })

  it.each([false, true])(
    '主题变化和动态装饰重新绘制（动画 %s）',
    async (animated) => {
      const f = fixture(animated)
      f.surface.update(0)
      await flushPromises()
      if (!animated) f.label.element.style.color = 'red'
      f.surface.update(100)
      await flushPromises()
      expect(f.draw).toHaveBeenCalledTimes(2)
      f.surface.dispose()
    },
  )

  it('绘制失败显式降级，下一次有效更新恢复三维牌面', async () => {
    const f = fixture()
    f.draw.mockRejectedValueOnce(new Error('canvas unavailable'))
    f.surface.update(0)
    await flushPromises()
    f.surface.setOpacity(0.6)
    expect(f.label.element.dataset.textureError).toBe('信息牌纹理生成失败')
    expect(f.label.element.style.opacity).toBe('0.6')
    f.surface.invalidate()
    f.surface.update(100)
    await flushPromises()
    expect(f.label.element.dataset.textureError).toBeUndefined()
    expect(f.label.element.title).toBe('')
    expect(f.label.element.style.opacity).toBe('0')
    f.surface.dispose()
  })
})
