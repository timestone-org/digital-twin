/**
 * @fileoverview glTF/glb 装载：进度回传与取消丢弃。
 * ⚠ `GLTFLoader` 没有中止能力，取消只能在解析完成后把成果丢掉并**逐个释放**——
 * 丢而不释放就是一次纯泄漏，而快速切模型正是最容易触发它的路径。
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type * as THREE from 'three'

import { disposeSceneGraph } from './sceneCore'

/** `GLTFLoader` 的最小面，装载编排只依赖它，测试传替身。 */
export interface GltfSource {
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<{ scene: THREE.Object3D }>
}

export interface TwinModelLoadOptions {
  /** 已下载字节 / 总字节；总字节为 0 表示服务端没给长度。 */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/** 造一个真 `GLTFLoader`。 */
export function createGltfSource(): GltfSource {
  return new GLTFLoader()
}

function abortError(): DOMException {
  return new DOMException('模型加载已取消', 'AbortError')
}

// ⚠ 必须绕一层函数读：直接连着判两次 `signal.aborted`，控制流分析会把它当常量收窄，
// 而它恰恰是这段代码里唯一会在 await 期间变掉的东西
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/**
 * 下载并解析一个模型；取消后抛 `AbortError` 且不留下半个场景。
 * @param url 模型地址
 * @param options 进度回调与取消信号
 * @param source 装载器，缺省是真 `GLTFLoader`
 */
export async function loadTwinModel(
  url: string,
  options: TwinModelLoadOptions = {},
  source: GltfSource = createGltfSource(),
): Promise<THREE.Object3D> {
  if (isAborted(options.signal)) throw abortError()
  const gltf = await source.loadAsync(url, (event) => {
    options.onProgress?.(event.loaded, event.lengthComputable ? event.total : 0)
  })
  if (isAborted(options.signal)) {
    disposeSceneGraph(gltf.scene)
    throw abortError()
  }
  return gltf.scene
}
