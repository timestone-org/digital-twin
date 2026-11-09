/**
 * @fileoverview 守模型装载的契约：进度按字节回传、服务端没给长度时总数是 0、
 * 取消后抛 AbortError 且**已解析出来的 GPU 资源被逐个释放**（丢而不释放是纯泄漏）。
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { configureTwinModelHost, resetTwinModelHost } from '../src/host'
import { describe, expect, it, vi } from 'vitest'

import {
  createGltfSource,
  disposeGltfDecoders,
  loadTwinModel,
  type GltfSource,
} from '../src/modelLoader'

function scene(): THREE.Object3D {
  const root = new THREE.Group()
  root.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    ),
  )
  return root
}

function progressEvent(loaded: number, total: number): ProgressEvent {
  return new ProgressEvent('progress', {
    lengthComputable: total > 0,
    loaded,
    total,
  })
}

function sourceOf(
  root: THREE.Object3D,
  events: ProgressEvent[] = [],
): GltfSource {
  return {
    loadAsync: (_url, onProgress) => {
      for (const event of events) onProgress?.(event)
      return Promise.resolve({ scene: root })
    },
  }
}

describe('模型装载', () => {
  it('解码器与应用入口共用部署前缀', () => {
    configureTwinModelHost({
      resolveModelUrl: () => '',
      dracoDecoderPath: '/ai/draco/',
    })
    const decoderPath = vi.spyOn(DRACOLoader.prototype, 'setDecoderPath')
    disposeGltfDecoders()
    try {
      createGltfSource()
      expect(decoderPath).toHaveBeenCalledWith('/ai/draco/')
    } finally {
      disposeGltfDecoders()
      decoderPath.mockRestore()
      resetTwinModelHost()
    }
  })

  it('解析成功时把 gltf 的场景交出去', async () => {
    const root = scene()

    await expect(
      loadTwinModel('/m.glb', {}, sourceOf(root)),
    ).resolves.toStrictEqual({ root, clips: [] })
  })

  // ⚠ `gltf.animations` 与 `gltf.scene` 是并列的两半，只取 scene 的话 GLB 里的
  // 内置动画就此丢失，而模型看着是正常加载出来的
  it('模型自带的动画剪辑跟着交出来，不被丢掉', async () => {
    const root = scene()
    const clip = new THREE.AnimationClip('转动', -1, [])
    const source = {
      loadAsync: () => Promise.resolve({ scene: root, animations: [clip] }),
    }

    const asset = await loadTwinModel('/m.glb', {}, source)

    expect(asset.clips).toEqual([clip])
  })

  it('进度按已下载与总字节回传', async () => {
    const onProgress = vi.fn()

    await loadTwinModel(
      '/m.glb',
      { onProgress },
      sourceOf(scene(), [progressEvent(30, 100)]),
    )

    expect(onProgress).toHaveBeenCalledWith(30, 100)
  })

  it('服务端没给长度时总字节报 0，不拿 0 当分母', async () => {
    const onProgress = vi.fn()

    await loadTwinModel(
      '/m.glb',
      { onProgress },
      sourceOf(scene(), [progressEvent(30, 0)]),
    )

    expect(onProgress).toHaveBeenCalledWith(30, 0)
  })

  it('传入时已中止的信号直接抛 AbortError，不发请求', async () => {
    const controller = new AbortController()
    controller.abort()
    const loadAsync = vi.fn(() => Promise.resolve({ scene: scene() }))

    await expect(
      loadTwinModel('/m.glb', { signal: controller.signal }, { loadAsync }),
    ).rejects.toThrow('模型加载已取消')
    expect(loadAsync).not.toHaveBeenCalled()
  })

  it('解析途中被取消时抛 AbortError 并释放已解析出来的资源', async () => {
    const controller = new AbortController()
    const root = scene()
    const mesh = root.children[0] as THREE.Mesh
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose')
    const source: GltfSource = {
      loadAsync: () => {
        controller.abort()
        return Promise.resolve({ scene: root })
      },
    }

    await expect(
      loadTwinModel('/m.glb', { signal: controller.signal }, source),
    ).rejects.toThrow('模型加载已取消')
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })

  it('装载器出错时原样上抛', async () => {
    const source: GltfSource = {
      loadAsync: () => Promise.reject(new Error('HTTP 404')),
    }

    await expect(loadTwinModel('/m.glb', {}, source)).rejects.toThrow(
      'HTTP 404',
    )
  })

  it('缺省装载器是一个真 GLTFLoader', () => {
    expect(typeof createGltfSource().loadAsync).toBe('function')
  })
})

describe('缺省装载器的下载', () => {
  // ⚠ 只在下载完之后才看取消的话，快速切模型时每个被换掉的几十兆 GLB 都照样下完、解完
  it('取消时把在途的下载一起掐掉', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal ?? undefined
        seen = signal
        // 与真 fetch 一样：信号一断就以 AbortError 落地
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }),
    )
    const controller = new AbortController()

    const pending = loadTwinModel('/m.glb', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow()
    expect(seen?.aborted).toBe(true)
    vi.unstubAllGlobals()
  })

  it('HTTP 失败时报出状态码，不交给解析器', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    )

    await expect(loadTwinModel('/m.glb')).rejects.toThrow('404')
    vi.unstubAllGlobals()
  })
})
