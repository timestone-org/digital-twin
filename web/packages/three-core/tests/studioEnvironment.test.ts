/** @fileoverview 环境光加载成功、失败、卸载竞态与内置 EXR 的解码契约。 */
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import {
  __resetStudioEnvironment,
  attachStudioEnvironment,
  loadStudioEnvironment,
} from '../src/studioEnvironment'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetStudioEnvironment()
})

it('加载失败保留补光并标记降级', async () => {
  const scene = new THREE.Scene()
  const fallback = new THREE.Group()
  const cancel = attachStudioEnvironment(scene, fallback, () =>
    Promise.reject(new Error('unavailable')),
  )
  await vi.waitFor(() =>
    expect(scene.userData['environmentStatus']).toBe('fallback'),
  )
  expect(fallback.visible).toBe(true)
  expect(scene.environment).toBeNull()
  cancel()
})

it('卸载后迟到的纹理释放且不写回场景', async () => {
  const scene = new THREE.Scene()
  const texture = new THREE.Texture()
  const dispose = vi.spyOn(texture, 'dispose')
  let finish: (texture: THREE.Texture) => void = () => {}
  const pending = new Promise<THREE.Texture>((resolve) => {
    finish = resolve
  })
  const cancel = attachStudioEnvironment(
    scene,
    new THREE.Group(),
    () => pending,
  )
  cancel()
  finish(texture)
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  expect(scene.environment).toBeNull()
})

it('内置环境图解码为线性 HDR 且遵循 EXR 的上下方向', async () => {
  const bytes = await readFile('packages/three-core/src/assets/forest.exr')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)))
  const texture = await loadStudioEnvironment(new AbortController().signal)
  expect(texture).toBeInstanceOf(THREE.DataTexture)
  expect(texture.colorSpace).toBe(THREE.LinearSRGBColorSpace)
  expect(texture.flipY).toBe(false)
  expect(texture.type).toBe(THREE.HalfFloatType)
  texture.dispose()
})

it('环境图 HTTP 失败不交给解码器', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  )
  await expect(
    loadStudioEnvironment(new AbortController().signal),
  ).rejects.toThrow('环境光资源加载失败')
})

// ⚠ 每个场景、每开一次详情弹窗都在主线程上解一遍 DWAB 压缩的 EXR，卡顿按场景数叠加
it('多个场景共用一次下载与解码，各自拿到自己的纹理', async () => {
  const bytes = await readFile('packages/three-core/src/assets/forest.exr')
  const fetcher = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(bytes)))
  vi.stubGlobal('fetch', fetcher)
  const parse = vi.spyOn(EXRLoader.prototype, 'parse')

  const first = await loadStudioEnvironment(new AbortController().signal)
  const second = await loadStudioEnvironment(new AbortController().signal)

  expect(fetcher).toHaveBeenCalledOnce()
  expect(parse).toHaveBeenCalledOnce()
  expect(second).not.toBe(first)
  first.dispose()
  second.dispose()
})

it('上一次失败后下一次重新加载', async () => {
  const bytes = await readFile('packages/three-core/src/assets/forest.exr')
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)

  await expect(
    loadStudioEnvironment(new AbortController().signal),
  ).rejects.toThrow('环境光资源加载失败')
  const texture = await loadStudioEnvironment(new AbortController().signal)

  expect(texture).toBeInstanceOf(THREE.DataTexture)
  texture.dispose()
})

// ⚠ 一个场景卸载取消了加载，不能连带把别的场景要等的那一份也作废
it('一个调用方取消不影响共用的那份', async () => {
  const bytes = await readFile('packages/three-core/src/assets/forest.exr')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response(bytes))),
  )
  const controller = new AbortController()

  const cancelled = loadStudioEnvironment(controller.signal)
  const kept = loadStudioEnvironment(new AbortController().signal)
  controller.abort()

  await expect(cancelled).rejects.toBeDefined()
  const texture = await kept
  expect(texture).toBeInstanceOf(THREE.DataTexture)
  texture.dispose()
})
