/** @fileoverview 原生牌面尺寸、投影、深度代理与资源释放。 */
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'

import { nativeSurface } from '../src/testing/nativePanelFixture'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('保持原生 DOM，不创建卡片纹理，代理只参与深度合成', () => {
  const { surface, card } = nativeSurface()
  expect(surface.element.children[0]).toBe(card)
  expect(surface.proxy.material.map).toBeNull()
  expect(surface.proxy.material.depthTest).toBe(true)
  expect(surface.proxy.material.depthWrite).toBe(false)
  expect(surface.proxy.material.blending).toBe(THREE.NoBlending)
  expect(surface.proxy.material.opacity).toBe(0)
  expect(surface.element.style.opacity).toBe('')
  surface.dispose()
})

it('尺寸不变时不重复读取布局，阴影范围被纳入投影', () => {
  const { surface, card } = nativeSurface()
  const width = vi.spyOn(card, 'offsetWidth', 'get')
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(true)
  const reads = width.mock.calls.length
  expect(surface.clipPolygon.getAttribute('points')).not.toBe('')
  surface.sync(new THREE.Matrix4(), 200, 100)
  expect(width).toHaveBeenCalledTimes(reads)
  surface.dispose()
})

it('未挂载与视锥外的牌不参与合成，移回后恢复', () => {
  const { surface } = nativeSurface()
  surface.element.remove()
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(false)
  document.body.append(surface.element)
  surface.position.x = 20
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(false)
  expect(surface.element.style.visibility).toBe('hidden')
  surface.position.x = 0
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(true)
  expect(surface.element.style.visibility).toBe('')
  surface.dispose()
})

it('卸载释放代理资源与 ResizeObserver，重复释放安全', () => {
  const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
  const { surface } = nativeSurface()
  const geometry = vi.spyOn(surface.proxy.geometry, 'dispose')
  const material = vi.spyOn(surface.proxy.material, 'dispose')
  surface.dispose()
  surface.dispose()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(geometry).toHaveBeenCalledOnce()
  expect(material).toHaveBeenCalledOnce()
  expect(surface.element.isConnected).toBe(false)
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(false)
})

it('尺寸变化通知会更新深度范围', () => {
  let resize = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  const { surface, card } = nativeSurface()
  surface.sync(new THREE.Matrix4(), 200, 100)
  const previous = surface.clipPolygon.getAttribute('points')
  vi.spyOn(card, 'offsetWidth', 'get').mockReturnValue(400)
  resize()
  surface.sync(new THREE.Matrix4(), 200, 100)
  expect(surface.clipPolygon.getAttribute('points')).not.toBe(previous)
  surface.dispose()
})

it('动态文字的溢出宽度也纳入原生卡片覆盖范围', () => {
  const { surface, card } = nativeSurface()
  surface.sync(new THREE.Matrix4(), 200, 100)
  const previous = surface.clipPolygon.getAttribute('points')
  vi.spyOn(card, 'scrollWidth', 'get').mockReturnValue(350)
  surface.invalidateBounds()
  surface.sync(new THREE.Matrix4(), 200, 100)
  expect(surface.clipPolygon.getAttribute('points')).not.toBe(previous)
  surface.dispose()
})

it('等待布局就绪，并支持没有 CSS 平移的卡片', () => {
  const { surface, card } = nativeSurface()
  card.style.transform = 'none'
  const width = vi.spyOn(card, 'offsetWidth', 'get').mockReturnValue(0)
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(false)
  width.mockReturnValue(200)
  expect(surface.sync(new THREE.Matrix4(), 200, 100)).toBe(true)
  surface.dispose()
})
